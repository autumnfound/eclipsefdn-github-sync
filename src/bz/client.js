/*! **************************************************************
 Copyright (C) 2021 Eclipse Foundation, Inc.

 This program and the accompanying materials are made
 available under the terms of the Eclipse Public License 2.0
 which is available at https://www.eclipse.org/legal/epl-2.0/

  Contributors:
    Martin Lowe <martin.lowe@eclipse-foundation.org>

 SPDX-License-Identifier: EPL-2.0
**************************************************************** */

const VERBOSE_SECONDARY_BASIC = 1;
const VERBOSE_SECONDARY_MEDIUM = 2;

const axios = require('axios');
const BASE_PAGE_SIZE = 10;

class BugzillaClient {
  #apiKey;
  #serverHost;
  #verbose = false;
  set verbose(val) {
    if (typeof val === 'number') {
      this.#verbose = val;
    }
  }
  get verbose() {
    return this.#verbose;
  }

  constructor(serverHost, apiKey) {
    this.#apiKey = apiKey;
    this.#serverHost = serverHost;
  }

  async getBugs(product, component, filters = {}) {
    // setup pagination vars needed
    let out = [];
    let offset = 0;
    let count = await this.countBugs(product, component, filters);
    // while there are results, continue processing
    while (offset < count) {
      // set up params for the current call including offset + limit
      let params = Object.assign({}, filters, {
        api_key: this.#apiKey,
        product: product,
        component: component,
        offset: offset,
        limit: BASE_PAGE_SIZE,
      });

      let results = await axios.get(getURL(this.#serverHost, 'rest/bug'), {
        params: params,
      }).then(r => {
        // log HTTP response for successful requests when verbose enabled
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(r);
        }
        return r.data.bugs;
      }).catch(err => {
        console.log(err);
      });
      if (results === undefined) {
        console.log(`Error while looking for bugs. Params: ${params}`);
      } else {
        offset += BASE_PAGE_SIZE;
        out = out.concat(results);
      }
    }
    return out;
  }

  async getCommentsForBug(bugID, filters) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`BugzillaClient::getCommentsForBug(bugID = ${bugID}, filters = ${JSON.stringify(filters)})`);
    }
    // set up params for the current call
    let params = Object.assign({}, filters, {
      api_key: this.#apiKey,
    });

    return await axios.get(getURL(this.#serverHost, `rest/bug/${bugID}/comment`), {
      params: params,
    }).then(r => {
      // log HTTP response for successful requests when verbose enabled
      if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
        console.log(r);
      }
      return r.data.bugs[bugID].comments;
    }).catch(err => {
      console.log(err);
    });
  }

  /**
  Count bugs available for current filters. As there is no dedicated count endpoint available to current API, a workaround was
  created. A single request with no limit is made that retrieves only the ID of the bugs to minimize traffic/payload.

  @param {String} product (at least one of, product or component) the product to retrieve bugs for.
  @param {String} component (at least one of, product or component) the component to retrieve bugs for.
  @param {Record<String, String>} filters additional filters to apply to the request. These should be formatted as described in the
      Bugzilla API documentation.
   */
  async countBugs(product, component, filters = {}) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`BugzillaClient::countBugs(product = ${product},  = ${component}, filters = ${JSON.stringify(filters)})`);
    }
    let params = Object.assign({}, filters, {
      api_key: this.#apiKey,
      product: product,
      component: component,
      limit: 0,
    });

    // make the request
    return await axios.get(getURL(this.#serverHost, 'rest/bug'), {
      params: params,
    }).then(r => {
      // log HTTP response for successful requests when verbose enabled
      if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
        console.log(r);
      }
      // return the count
      return r.data.bugs.length;
    }).catch(err => {
      console.log(err);
    });
  }

  /**
  Retrieves attachment with the specified ID. There is no pagination available for this call, so bugs with large
  attachments may hang for a short time.

  @param attachmentID the ID of the attachment to retrieve
   */
  async getAttachment(attachmentID) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`BugzillaClient::getAttachment(attachmentID = ${attachmentID})`);
    }
    try {
      return await axios.get(getURL(this.#serverHost, `rest/bug/attachment/${attachmentID}`), {
        params: {
          api_key: this.#apiKey,
        },
      }).then(r => {
        // log HTTP response for successful requests when verbose enabled
        if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
          console.log(r);
        }
        // return the count
        return r.data.attachments[attachmentID];
      });
    } catch (err) {
      console.log(err);
    }
  }
}
/**
Helper method to format URL, allowing for additional slash on URL if set.

@param root root URL for Bugzilla server home page (i.e. https://bugs.eclispe.org/bugs)
@param path the rest resource path (including rest), should not start with leading slash
@returns full URL for given root URL and path to REST resource.
 */
function getURL(root, path) {
  return root.endsWith('/') ? root + path : root + '/' + path;
}
// export the class to be used
module.exports.BugzillaClient = BugzillaClient;
