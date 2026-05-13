'use strict';

angular.module('bahmni.claims')
    .factory('initialization', ['$rootScope', '$q', 'appService', 'spinner', 'configurations',
        function ($rootScope, $q, appService, spinner, configurations) {
            var loadConfigPromise = function () {
                var configNames = ['quickLogoutComboKey', 'contextCookieExpirationTimeInMinutes'];
                return configurations.load(configNames).then(function () {
                    $rootScope.quickLogoutComboKey = configurations.quickLogoutComboKey() || 'Escape';
                    $rootScope.cookieExpiryTime = configurations.contextCookieExpirationTimeInMinutes() || 0;
                });
            };

            var initApp = function () {
                return appService.initApp('claims');
            };

            return spinner.forPromise(initApp().then(loadConfigPromise));
        }
    ]);
