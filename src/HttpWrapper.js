/** **************************************************************
 Copyright (C) 2019 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
******************************************************************/

/** default cache time of 2 hours */
const DEFAULT_CACHE_TIME = 120;

const axios = require('axios');
const TimeCache = require('./TimeCache.js');

// variables for use with the cache
const httpCacheID = 'http.cache';
const cacheLoc = './.cache';

class HttpWrapper {
  // guarded verbose value
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'boolean') {
      this.#verbose = val;
    }
  }
  get verbose() {
    return this.#verbose;
  }
  #cacheTime;
  #httpCache;

  constructor(cacheTime) {
    this.#cacheTime = cacheTime | DEFAULT_CACHE_TIME;
    this.#httpCache = new TimeCache(httpCacheID, cacheLoc, this.#cacheTime);
  }

  getData(url) {
    // check that we haven't retrieved data yet
    var cacheResult = this.#httpCache.getKey(url);
    if (cacheResult != null) {
      console.log(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }

    // return promise that returns data after caching it
    return axios.get(url)
      .then(result => {
        httpCache.setKey(url, result.data);

        return result.data;
      })
      .catch(err => console.log(err));
  }

  async getRaw(url) {
    // check that we haven't retrieved data yet
    var cacheResult = this.#httpCache.getKey(url);
    if (cacheResult != null) {
      console.log(`Found cached result for endpoint call ${url}`);
      return cacheResult;
    }

    // create call that returns error or result raw, no processing
    var raw = await axios.get(url)
      .then(result => {
        this.#httpCache.setKey(url, result);

        return result;
      })
      .catch(err => {
        console.log(err);
        return err;
      });
    return raw;
  }

  close() {
    this.#httpCache.save(true);
  }
}
module.exports.HttpWrapper = HttpWrapper;
