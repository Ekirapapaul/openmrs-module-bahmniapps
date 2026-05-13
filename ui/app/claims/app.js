'use strict';

angular.module('claims', [
    'httpErrorInterceptor',
    'bahmni.claims',
    'bahmni.common.routeErrorHandler',
    'ngSanitize',
    'bahmni.common.uiHelper',
    'bahmni.common.config',
    'bahmni.common.i18n',
    'pascalprecht.translate',
    'ngCookies'
]).config(['$stateProvider', '$httpProvider', '$urlRouterProvider', '$compileProvider', '$bahmniTranslateProvider',
    function ($stateProvider, $httpProvider, $urlRouterProvider, $compileProvider, $bahmniTranslateProvider) {
        $urlRouterProvider.otherwise('/dashboard');

        $stateProvider.state('claims', {
            abstract: true,
            template: '<ui-view/>',
            resolve: {
                initialize: 'initialization'
            }
        }).state('claims.dashboard', {
            url: '/dashboard',
            templateUrl: 'views/dashboard.html',
            controller: 'ClaimsDashboardController',
            data: {
                backLinks: [{label: "Home", accessKey: "h", url: "../home/", icon: "fa-home"}]
            }
        }).state('claims.list', {
            url: '/list?insurer&status&from&to&q&page&pageSize',
            templateUrl: 'views/list.html',
            controller: 'ClaimsListController',
            reloadOnSearch: false,
            data: {
                backLinks: [
                    {label: "Home", accessKey: "h", url: "../home/", icon: "fa-home"},
                    {label: "Dashboard", state: "claims.dashboard", icon: "fa-tachometer"}
                ]
            }
        }).state('claims.detail', {
            url: '/detail/:id',
            templateUrl: 'views/detail.html',
            controller: 'ClaimsDetailController',
            data: {
                backLinks: [
                    {label: "Home", accessKey: "h", url: "../home/", icon: "fa-home"},
                    {label: "List", state: "claims.list", icon: "fa-list"}
                ]
            }
        });

        $httpProvider.defaults.headers.common['Disable-WWW-Authenticate'] = true;
        $bahmniTranslateProvider.init({app: 'claims', shouldMerge: true});
    }
]).run(['$rootScope', '$templateCache', '$window', function ($rootScope, $templateCache, $window) {
    moment.locale($window.localStorage["NG_TRANSLATE_LANG_KEY"] || "en");
    $rootScope.$on('$viewContentLoaded', $templateCache.removeAll);
}]);
