// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('../web_apis/release.es6.js');
require('./browser_metric_data.es6.js');
require('./metric_computer.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'BrowserSpecific',
  extends: 'org.chromium.apis.web.MetricComputer',
  implements: ['foam.mlang.Expressions'],

  documentation: `Metric computer for count of APIs that:

      (1) Have been shipping in this browser for the duration of a one-year
          grace period,
      and
      (2) Have not shipped in any other browser at any point during the
          one-year grace period.`,

  requires: [
    'foam.dao.AnonymousSink',
    'foam.dao.EasyDAO',
    'foam.mlang.ExpressionsSingleton',
    'org.chromium.apis.web.BrowserMetricData',
    'org.chromium.apis.web.BrowserMetricDataType',
    'org.chromium.apis.web.generated.CompatData',
    'org.chromium.apis.web.CompatProperty',
    'org.chromium.apis.web.Release',
  ],
  imports: [
    'browserMetricsDAO',
    'compatDAO',
    'info',
  ],

  properties: [
    {
      class: 'foam.dao.DAOProperty',
      name: 'browserSpecificDAO',
      documentation: `This is a DAO that contains browser-specific data.`,
      final: true,
      factory: function() {
        return this.browserMetricsDAO.where(this.EQ(
            this.BrowserMetricData.TYPE,
            this.BrowserMetricDataType.BROWSER_SPECIFIC));
      },
    },
  ],

  methods: [
    {
      name: 'compute',
      documentation: `Compute browser-specific value for each release in
          "releases", given "date".`,
      code: function(releases, date) {
        return Promise.all(releases.map(
            release => this.computeForRelease(releases, date, release)));
      },
    },
    {
      name: 'computeForRelease',
      documentation: 'Compute browser-specific value for a single release.',
      code: function(releases, date, release) {
        this.info(`Computing browser-specific: ${date}, ${release.id}`);
        let otherReleases = releases
            .filter(rls => !foam.util.equals(rls.id, release.id));
        const gracePeriodStart = new Date(date.getFullYear() - 1,
                                          date.getMonth(),
                                          date.getDate());
        // Compared releases: Releases of browsers other than "release"'s
        // browser, that were released during the grace period.
        const comparedReleases = this.releaseDAO.where(
            this.AND(
                // LTE: Include other releases on the same date as "release".
                this.LTE(this.Release.RELEASE_DATE, date),
                this.GTE(this.Release.RELEASE_DATE, gracePeriodStart),
                this.OR.apply(
                    this,
                    otherReleases.map(rls => this.AND(
                        this.EQ(this.Release.BROWSER_NAME, rls.browserName),
                        this.EQ(this.Release.OS_NAME, rls.osName))))));
        // Previous releases: Releases of "release"'s browser released during
        // the grace pariod.
        const prevReleases = this.releaseDAO.where(
            this.AND(
                // LT: Exclude "release".
                this.LT(this.Release.RELEASE_DATE, date),
                this.GTE(this.Release.RELEASE_DATE, gracePeriodStart),
                this.EQ(this.Release.BROWSER_NAME, release.browserName),
                this.EQ(this.Release.OS_NAME, release.osName)));
        return Promise.all([comparedReleases.select(), prevReleases.select()])
            .then(results => this.computeFromGracePeriodReleases(
                results[0].array, results[1].array, date, release));
      },
    },
    {
      name: 'computeFromGracePeriodReleases',
      documentation: `Compute browser-specific value based on browsers released
          during grace period.`,
      code: function(comparedReleases, prevReleases, date, release) {
        const thisReleases = prevReleases.concat([release])
        const thisProps = thisReleases.map(r => this.getPropertyForRelease(r));
        const comparedProps = comparedReleases
            .map(r => this.getPropertyForRelease(r));
        const E = this.ExpressionsSingleton.create();

        // Shipped by all grace period releases of this browser, and no grace
        // period releases in other browsers.
        const query = E.AND.apply(E, thisProps.map(p => E.EQ(p, true)).concat(
            comparedProps.map(p => E.EQ(p, false))));
        return this.compatDAO.where(query).select(this.COUNT())
          .then(count => {
            return this.browserSpecificDAO.put(
                this.BrowserMetricData.create({
                  type: this.BrowserMetricDataType.BROWSER_SPECIFIC,
                  browserName: release.browserName,
                  value: count.value,
                  release,
                  date,
                  prevReleases,
                  comparedReleases,
                }));
          });
      },
    },
  ],
});
