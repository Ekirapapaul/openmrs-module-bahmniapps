(function () {
    'use strict';

    angular.module('bahmni.home').controller('CascadeLoginController', [
        '$scope', '$http', '$q',
        function ($scope, $http, $q) {

            var STORAGE_KEY = 'primecare.lastSelectedFacility';
            var REST = '/openmrs/ws/rest/v1';

            $scope.cascadeLoading = true;
            $scope.cascadeError = null;
            $scope.facilities = [];
            $scope.serviceLocations = [];
            $scope.cascade = { selectedFacility: null };
            $scope.locationsByFacility = {};

            var stripFacilitySuffix = function (text, facilityName) {
                if (!text || !facilityName) return text;
                var suffix = ' - ' + facilityName;
                return text.length > suffix.length && text.slice(-suffix.length) === suffix
                    ? text.slice(0, -suffix.length)
                    : text;
            };

            var buildShortDisplay = function (loc, facilityName) {
                var raw = loc.display || loc.name;
                return stripFacilitySuffix(raw, facilityName);
            };

            $scope.onFacilityChange = function () {
                if (!$scope.cascade.selectedFacility) {
                    $scope.serviceLocations = [];
                    if ($scope.loginInfo) $scope.loginInfo.currentLocation = null;
                    return;
                }

                try { localStorage.setItem(STORAGE_KEY, $scope.cascade.selectedFacility.uuid); } catch (e) { /* noop */ }

                var children = $scope.locationsByFacility[$scope.cascade.selectedFacility.uuid] || [];
                var facilityName = $scope.cascade.selectedFacility.name;
                $scope.serviceLocations = children.map(function (loc) {
                    var clone = angular.extend({}, loc);
                    clone.shortDisplay = buildShortDisplay(loc, facilityName);
                    return clone;
                });

                if ($scope.loginInfo) $scope.loginInfo.currentLocation = null;
            };

            var fetchFacilities = $http.get(REST + '/location', {
                params: { tags: 'Facility', s: 'byTags', v: 'default' }
            });
            var fetchServicePoints = $http.get(REST + '/location', {
                params: { tags: 'Login Location', s: 'byTags', v: 'full' }
            });

            $q.all([fetchFacilities, fetchServicePoints]).then(function (responses) {
                var allFacilities = (responses[0].data && responses[0].data.results) || [];
                var loginLocations = (responses[1].data && responses[1].data.results) || [];

                var byFacility = {};
                loginLocations.forEach(function (loc) {
                    var parentUuid = loc.parentLocation && loc.parentLocation.uuid;
                    if (!parentUuid) return;
                    (byFacility[parentUuid] = byFacility[parentUuid] || []).push(loc);
                });

                var visibleFacilities = allFacilities.filter(function (f) {
                    return byFacility[f.uuid] && byFacility[f.uuid].length > 0;
                });

                $scope.locationsByFacility = byFacility;
                $scope.facilities = visibleFacilities;
                $scope.cascadeLoading = false;

                if (visibleFacilities.length === 1) {
                    $scope.cascade.selectedFacility = visibleFacilities[0];
                    $scope.onFacilityChange();
                    return;
                }

                try {
                    var lastUuid = localStorage.getItem(STORAGE_KEY);
                    if (lastUuid) {
                        var match = visibleFacilities.filter(function (f) { return f.uuid === lastUuid; })[0];
                        if (match) {
                            $scope.cascade.selectedFacility = match;
                            $scope.onFacilityChange();
                        }
                    }
                } catch (e) { /* localStorage unavailable */ }
            }, function () {
                $scope.cascadeLoading = false;
                $scope.cascadeError = 'Failed to load locations';
            });
        }
    ]);
})();
