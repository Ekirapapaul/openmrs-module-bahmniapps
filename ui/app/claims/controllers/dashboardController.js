'use strict';

angular.module('bahmni.claims')
    .controller('ClaimsDashboardController', ['$scope', '$state', 'claimsService',
        function ($scope, $state, claimsService) {
            $scope.loading = true;
            $scope.error = null;
            $scope.summary = null;
            $scope.appeals = [];

            // Roll the raw byStatus map into the categories the dashboard
            // actually wants to surface as cards (matches SRS §11.7 +
            // §11.8). We do this client-side so the API stays simple.
            var summariseGroups = function (byStatus) {
                var get = function (k) { return (byStatus && byStatus[k]) || { count: 0 }; };
                return {
                    drafts: get('DRAFT').count,
                    submitted:
                        get('SUBMITTED').count +
                        get('INSURER_RECEIVED').count +
                        get('INSURER_REVIEWING').count,
                    approved: get('APPROVED').count + get('PARTIALLY_APPROVED').count,
                    denied: get('DENIED').count,
                    paid: get('PAID').count + get('PARTIALLY_PAID').count,
                    appealPending: get('APPEAL_PENDING').count
                };
            };

            $scope.goTo = function (status) {
                $state.go('claims.list', { status: status, page: 1 });
            };

            $scope.openAppeal = function (id) {
                $state.go('claims.detail', { id: id });
            };

            claimsService.summary().then(function (resp) {
                $scope.summary = resp.data;
                $scope.cards = summariseGroups(resp.data.byStatus);
                $scope.ageing = resp.data.ageing;
                $scope.loading = false;
            }, function (err) {
                $scope.error = (err && err.data && err.data.error) || 'Failed to load summary';
                $scope.loading = false;
            });

            claimsService.appeals().then(function (resp) {
                $scope.appeals = resp.data.rows || [];
            }, function () {
                // Non-fatal — leave the appeals section empty.
            });
        }
    ]);
