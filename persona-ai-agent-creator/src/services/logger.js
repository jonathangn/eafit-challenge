'use strict';

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const level = levels[process.env.LOG_LEVEL] || 2;

function prefix(lvl) {
  return `[${new Date().toISOString()}] [${lvl.toUpperCase()}]`;
}

const logger = {
  error: (...args) => { if (levels.error <= level) console.error(prefix('error'), ...args); },
  warn:  (...args) => { if (levels.warn <= level)  console.warn(prefix('warn'), ...args);  },
  info:  (...args) => { if (levels.info <= level)  console.log(prefix('info'), ...args);   },
  debug: (...args) => { if (levels.debug <= level) console.log(prefix('debug'), ...args);  },
};

module.exports = logger;
