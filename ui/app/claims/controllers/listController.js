'use strict';

angular.module('bahmni.claims')
    .controller('ClaimsListController', ['$scope', '$state', '$stateParams', '$location', 'claimsService',
        function ($scope, $state, $stateParams, $location, claimsService) {
            $scope.INSURERS = ['SHA', 'SLADE360', 'SMART', 'BUPA', 'CIGNA', 'AXA', 'ALLIANZ', 'OTHER'];
            $scope.STATUSES = [
                'DRAFT', 'PENDING_PREAUTH', 'PREAUTH_APPROVED', 'PREAUTH_DENIED',
                'SUBMITTED', 'INSURER_RECEIVED', 'INSURER_REVIEWING',
                'APPROVED', 'PARTIALLY_APPROVED', 'DENIED',
                'PAID', 'PARTIALLY_PAID', 'APPEAL_PENDING', 'CANCELLED'
            ];

            $scope.filters = {
                insurer: $stateParams.insurer || '',
                status: $stateParams.status || '',
                from: $stateParams.from || '',
                to: $stateParams.to || '',
                q: $stateParams.q || '',
                page: parseInt($stateParams.page, 10) || 1,
                pageSize: parseInt($stateParams.pageSize, 10) || 50
            };

            $scope.rows = [];
            $scope.total = 0;
            $scope.loading = false;
            $scope.error = null;

            $scope.load = function () {
                $scope.loading = true;
                $scope.error = null;
                claimsService.list($scope.filters).then(function (resp) {
                    $scope.rows = resp.data.rows || [];
                    $scope.total = resp.data.total || 0;
                    $scope.loading = false;
                    // Sync the address bar so the filter state is shareable.
                    $location.search({
                        insurer: $scope.filters.insurer || null,
                        status: $scope.filters.status || null,
                        from: $scope.filters.from || null,
                        to: $scope.filters.to || null,
                        q: $scope.filters.q || null,
                        page: $scope.filters.page,
                        pageSize: $scope.filters.pageSize
                    });
                }, function (err) {
                    $scope.error = (err && err.data && err.data.error) || 'Failed to load claims';
                    $scope.loading = false;
                });
            };

            $scope.apply = function () {
                $scope.filters.page = 1;
                $scope.load();
            };

            $scope.reset = function () {
                $scope.filters = { insurer: '', status: '', from: '', to: '', q: '', page: 1, pageSize: 50 };
                $scope.load();
            };

            $scope.totalPages = function () {
                return Math.max(1, Math.ceil($scope.total / $scope.filters.pageSize));
            };

            $scope.next = function () {
                if ($scope.filters.page < $scope.totalPages()) {
                    $scope.filters.page += 1;
                    $scope.load();
                }
            };
            $scope.prev = function () {
                if ($scope.filters.page > 1) {
                    $scope.filters.page -= 1;
                    $scope.load();
                }
            };

            $scope.open = function (id) {
                $state.go('claims.detail', { id: id });
            };

            $scope.load();
        }
    ]);
