const neataptic = require('neataptic');
const RSI = require('./RSI');
const SMA = require('./SMA');

class Indicator {
  /**
   * Constructor
   * 
   * @param {object} config - Config object must be defined as
   * {
   *   hiddenLayers: {integer}
   *   lookAhead   : {integer}
   *   history     : {integer}
   *   interations : {integer}
   *   rate        : {float}
   *   momentum    : {float}
   *   error       : {float}
   * }
   */
  constructor(config) {
    this.input = 'candle';
    this.config = config;
    this.prediction = 0;
    this.candles = [];
    this.normalizedCandles = [];
    this.maxOrders = {
      high: 0,
      low: 0,
      close: 0,
      open: 0,
      volume: 0,
      trades: 0
    };

    this.trainConfig = {
      log: 0,
      iterations: this.config.iterations || 1000,
      error: this.config.error || 0.03,
      rate: this.config.rate || 0.01,
      momentum: this.config.momentum || 0.1,
      ratePolicy: neataptic.methods.rate.STEP(),
      dropout: 0.01,
      crossValidate: {
        testSize: 0.2,
        testError: 0.001
      }
    };

    this.RSIs = [];
    this.SMAs = [];

    //Add RSI indicator[s]
    if (Array.isArray(this.config.rsi)) {
      for (let i = 0, iLen = this.config.rsi.length; i < iLen; i++) {
        if (parseInt(this.config.rsi[i])) {
          this.RSIs.push(new RSI({
            interval: this.config.rsi[i]
          }));
        }
      }
    }

    //Add SMA indicator[s]
    if (Array.isArray(this.config.sma)) {
      for (let i = 0, iLen = this.config.sma.length; i < iLen; i++) {
        if (parseInt(this.config.sma[i])) {
          this.SMAs.push(new SMA(this.config.sma[i]));
        }
      }
    }

    let inputs = 6 + this.RSIs.length + this.SMAs.length;
    let neuronsPerHL = Math.ceil(inputs + config.lookAhead / 2) + 5;
    const layers = [inputs];

    for (let i = 0; i < config.hiddenLayers; i++) {
      layers.push(neuronsPerHL);
    }
    layers.push(config.lookAhead);

    if (config.architecture === "LSTM") {
      this.network = new neataptic.architect.LSTM(...layers);
    } else {
      this.network = new neataptic.architect.Perceptron(...layers);
    }

    //annoying but necessary
    this.calcNormalizedCandles = this.calcNormalizedCandles.bind(this);
  }

  predict(candle) {
    let ret = this.network.activate(this.normalizeCandle(candle));
    ret = ret.map(item => {
      return item * this.getDividers().close;
    });

    this.prediction = ret;
  }

  /**
   * Feed data into the neural network and train
   */
  learn() {
    //Make sure we have enough data to make a prediction and check it for learning
    if (parseInt(this.config.lookAhead) && this.normalizedCandles.length > this.config.lookAhead) {
      const trainingData = [];

      for (let i = 0, iLen = this.normalizedCandles.length - this.config.lookAhead; i < iLen; i++) {
        const input = this.normalizedCandles[i];
        const output = [];
        for (let j = 1, jLen = this.config.lookAhead; j <= jLen; j++) {
          output.push(this.normalizedCandles[i + j][2]);
        }
        trainingData.push({
          input,
          output
        });
      }

      this.network.train(trainingData, this.trainConfig);

      this.normalizedCandles = this.normalizedCandles.slice(Math.max(this.normalizedCandles.length - this.config.lookAhead, 1));
    }
  }

  /**
   * Returns the number to divide data by for data normalization based on previously calculated orders of magnitude
   * 
   * @returns {object}
   */
  getDividers() {
    return {
      high: Math.pow(10, this.maxOrders.high + 1),
      low: Math.pow(10, this.maxOrders.low + 1),
      close: Math.pow(10, this.maxOrders.close + 1),
      open: Math.pow(10, this.maxOrders.open + 1),
      volume: Math.pow(10, this.maxOrders.volume + 1),
      trades: Math.pow(10, this.maxOrders.trades + 1)
    }
  }

  /** 
   * Recalculates values for all candles normalized for the neural network
   */
  calcNormalizedCandles() {
    const dividers = this.getDividers();

    this.normalizedCandles = this.candles.map((candle) => {
      return this.normalizeCandle(candle, dividers);
    });
  }

  /**
   * Calculates normalized inputs for a single candle
   * 
   * @param {object} candle - Candle data. Must have {high, low, close, open, volume, trades}
   * @param {object} dividers - Dividers used for normalizing. Must have {high, low, close, open, volume, trades}
   * @returns {object}
   */
  normalizeCandle(candle, dividers = undefined) {
    dividers = dividers || this.getDividers();

    let ret = [];

    ret.push(candle.high / dividers.high);
    ret.push(candle.low / dividers.low);
    ret.push(candle.close / dividers.close);
    ret.push(candle.open / dividers.open);
    ret.push(candle.volume / dividers.volume);
    ret.push(candle.trades / dividers.trades);

    for (let i = 0, iLen = candle.RSIs.length; i < iLen; i++) {
      ret.push(candle.RSIs[i] / 100);
    }

    for (let i = 0, iLen = candle.SMAs.length; i < iLen; i++) {
      ret.push(candle.SMAs[i] / dividers.high);
    }

    return ret;
  }

  /**
   * Takes in a new candle and figures out if the order of magnitudes for any of the previous candles used for data
   * normalization should change. If yes, recalculates all normalized data with new orders of magnitude.
   * If no, calculates the normalized data for the new candle and adds it to the array
   * 
   * @param {object} newCandle - Candle data. Must have {high, low, close, open, volume, trades}
   */
  normalizeAll() {
    this.setOrders();
    this.calcNormalizedCandles();
  }

  /**
   * Changes the orders of magnitude for any of the values that should be changed
   * 
   * @param {object} candle - Candle data. Must have {high, low, close, open, volume, trades}
   * @returns {bool} - True if orders of magnitude changed
   */
  setOrders() {
    for (let i = 0, iLen = this.candles.length; i < iLen; i++) {
      const candleOrders = {
        high: this.getOrder(this.candles[i].high),
        low: this.getOrder(this.candles[i].low),
        close: this.getOrder(this.candles[i].close),
        open: this.getOrder(this.candles[i].open),
        volume: this.getOrder(this.candles[i].volume),
        trades: this.getOrder(this.candles[i].trades)
      };

      this.maxOrders.high = candleOrders.high > this.maxOrders.high ? candleOrders.high : this.maxOrders.high;
      this.maxOrders.low = candleOrders.low > this.maxOrders.low ? candleOrders.low : this.maxOrders.low;
      this.maxOrders.close = candleOrders.close > this.maxOrders.close ? candleOrders.close : this.maxOrders.close;
      this.maxOrders.open = candleOrders.open > this.maxOrders.open ? candleOrders.open : this.maxOrders.open;
      this.maxOrders.volume = candleOrders.volume > this.maxOrders.volume ? candleOrders.volume : this.maxOrders.volume;
      this.maxOrders.trades = candleOrders.trades > this.maxOrders.trades ? candleOrders.trades : this.maxOrders.trades;
    }
  }

  /**
   * Returns the order of magnitude for a given number
   * 
   * @param {number} n - Number
   * @returns {integer}
   */
  getOrder(n) {
    return Math.floor(Math.log(n) / Math.LN10 + 0.000000001);
  }

  /**
   * Update function run on every new candle
   * 
   * @param {object} candle - Candle data. Must have {high, low, close, open, volume, trades}
   */
  update(candle) {
    const newCandle = Object.assign({}, candle);

    newCandle.RSIs = [];
    for (let i = 0, iLen = this.RSIs.length; i < iLen; i++) {
      this.RSIs[i].update(candle);
      newCandle.RSIs.push(this.RSIs[i].result);
    }

    newCandle.SMAs = [];
    for (let i = 0, iLen = this.SMAs.length; i < iLen; i++) {
      this.SMAs[i].update(candle.close);
      newCandle.SMAs.push(this.SMAs[i].result);
    }

    this.candles.push(newCandle);

    if (this.candles.length === this.config.history) {
      this.normalizeAll();
      this.learn();
    } else {
      this.normalizedCandles.push(this.normalizeCandle(newCandle));
      if (this.candles.length > this.config.history && parseInt(this.config.lookAhead) && this.normalizedCandles.length > this.config.lookAhead) {
        this.learn();
        this.predict(newCandle);
      }
    }
  }
}

module.exports = Indicator;