'use strict';

// Thin wrapper around the four GET endpoints exposed by
// primecare-integrations under /v1/claims. The proxy is expected to
// forward /primecare-integrations/* to the integration service container.
//
// Auth: the request carries the user's existing Bahmni session cookie
// (the integration service validates it back against OpenMRS), so no
// extra headers are required.

angular.module('bahmni.claims')
    .service('claimsService', ['$http', function ($http) {
        var BASE = '/primecare-integrations/v1/claims';

        var stripUndefined = function (params) {
            var out = {};
            angular.forEach(params || {}, function (v, k) {
                if (v !== undefined && v !== null && v !== '') {
                    out[k] = v;
                }
            });
            return out;
        };

        this.list = function (filters) {
            return $http.get(BASE, {
                params: stripUndefined(filters),
                withCredentials: true,
                cache: false
            });
        };

        this.summary = function () {
            return $http.get(BASE + '/summary', { withCredentials: true, cache: false });
        };

        this.appeals = function () {
            return $http.get(BASE + '/appeals', { withCredentials: true, cache: false });
        };

        this.detail = function (id) {
            return $http.get(BASE + '/' + encodeURIComponent(id), {
                withCredentials: true,
                cache: false
            });
        };
    }]);
