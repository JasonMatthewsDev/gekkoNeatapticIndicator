const config = require('../core/util.js').getConfig();
const log = require('../core/log.js');

const strat = {
  init() {
    this.name = 'NEAT Strat';
    this.requiredHistory = config.tradingAdvisor.historySize;

    config.backtest.batchSize = 1000;
    config.silent = true;
    config.debug = false;

    this.addIndicator('neat', 'NEAT', {
      hiddenLayers: this.settings.hiddenLayers,
      lookAhead: this.settings.lookAheadCandles,
      iterations: this.settings.iterations,
      error: this.settings.error,
      rate: this.settings.learnRate,
      momentum: this.settings.momentum,
      history: config.tradingAdvisor.historySize,
      rsi: this.settings.RSI,
      sma: this.settings.SMA
    });

    this.startTime = new Date();
  },

  check(candle) {
    if (this.candle.close.length < this.requiredHistory) {
      return;
    }
    let short = false;
    let long = 0;
    let minPercentMet = false;

    for (let i = 0, iLen = this.indicators.neat.prediction.length; i < iLen; i++) {
      if (i < this.settings.candlesForShort && this.indicators.neat.prediction[i] < candle.close) {
        short = true;
      }
      if (this.indicators.neat.prediction[i] > candle.close) {
        long++;
        minPercentMet = minPercentMet || (1 - (candle.close / this.indicators.neat.prediction[i])) * 100 > this.settings.minPercentIncrease;
      }
    }

    if (short) {
      this.advice('short');
    } else if (long >= this.settings.candlesForLong && minPercentMet) {
      this.advice('long');
    }
  },

  end() {
    let seconds = ((new Date() - this.startTime) / 1000),
      minutes = seconds / 60,
      str;

    minutes < 1 ? str = seconds.toFixed(2) + ' seconds' : str = minutes.toFixed(2) + ' minutes';

    log.info('====================================');
    log.info('Finished in ' + str);
    log.info('====================================');
  }
}

module.exports = strat;