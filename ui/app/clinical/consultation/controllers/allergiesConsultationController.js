'use strict';

/*
 * Backs the "Allergies" tab on the consultation board (PrimeCare).
 * Prepares the same `allergyData` payload that the patient dashboard
 * directive builds so the shared React micro-frontend
 * <mfe-next-ui-patient-alergies-control> renders identically in both
 * places. Writes go through the FHIR /AllergyIntolerance endpoint via
 * the React widget itself — no Angular plumbing required.
 */
angular.module('bahmni.clinical')
    .controller('AllergiesConsultationController', ['$scope', '$rootScope', 'appService', 'visitHistory',
        function ($scope, $rootScope, appService, visitHistory) {
            $scope.appService = appService;
            $scope.allergyData = {
                patient: $scope.patient,
                provider: $rootScope.currentProvider,
                activeVisit: visitHistory ? visitHistory.activeVisit : null,
                allergyControlConceptIdMap: appService.getAppDescriptor().getConfigValue('allergyControlConceptIdMap')
            };
        }]);
