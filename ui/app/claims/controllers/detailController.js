'use strict';

angular.module('bahmni.claims')
    .controller('ClaimsDetailController', ['$scope', '$state', '$stateParams', 'claimsService',
        function ($scope, $state, $stateParams, claimsService) {
            $scope.id = $stateParams.id;
            $scope.claim = null;
            $scope.loading = true;
            $scope.error = null;

            $scope.back = function () {
                $state.go('claims.list');
            };

            claimsService.detail($scope.id).then(function (resp) {
                $scope.claim = resp.data;
                $scope.loading = false;
            }, function (err) {
                $scope.error =
                    (err && err.data && err.data.error) || 'Failed to load claim';
                $scope.loading = false;
            });
        }
    ]);
