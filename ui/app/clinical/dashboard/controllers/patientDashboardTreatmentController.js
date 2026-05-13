'use strict';

angular.module('bahmni.clinical')
    .controller('PatientDashboardTreatmentController', ['$scope', '$rootScope', 'ngDialog', 'visitActionsService', 'treatmentService',
        function ($scope, $rootScope, ngDialog, visitActionsService, treatmentService) {
            var treatmentConfigParams = $scope.dashboard.getSectionByType("treatment") || {};
            $scope.isEmailPresent = $scope.patient.email ? true : false;
            var patientParams = {"patientUuid": $scope.patient.uuid, "isEmailPresent": $scope.isEmailPresent};
            var sharePrescriptionToggles = {"prescriptionEmailToggle": $rootScope.prescriptionEmailToggle};
            var printParams = treatmentConfigParams.prescriptionPrint || {};
            // Guard against $rootScope.facilityLocation being undefined (the REST call that
            // populates it runs asynchronously at clinical app init and can fail silently).
            // Without this guard the controller throws during construction and the
            // `event:downloadPrescriptionFromDashboard` listener below is never registered,
            // which is why the dashboard download icon previously "did nothing".
            var facilityLocation = $rootScope.facilityLocation || {};
            printParams.locationName = facilityLocation.name || "";

            var facilityAttributes = (facilityLocation && facilityLocation.attributes) || [];
            var printHeaderAttributes = facilityAttributes.filter(function (attribute) {
                return attribute && attribute.display && attribute.display.indexOf('Print Header') !== -1 && !attribute.voided;
            });
            printParams.locationAddress = printHeaderAttributes[0] && printHeaderAttributes[0].display.indexOf(':') !== -1
                ? printHeaderAttributes[0].display.split(":")[1].trim()
                : null;

            $scope.dashboardConfig = {};
            $scope.expandedViewConfig = {};
            _.extend($scope.dashboardConfig, treatmentConfigParams.dashboardConfig || {}, patientParams, sharePrescriptionToggles);
            _.extend($scope.expandedViewConfig, treatmentConfigParams.expandedViewConfig || {}, patientParams, sharePrescriptionToggles);

            $scope.openSummaryDialog = function () {
                ngDialog.open({
                    template: 'dashboard/views/dashboardSections/treatmentSummary.html',
                    params: $scope.expandedViewConfig,
                    className: "ngdialog-theme-default ng-dialog-all-details-page",
                    scope: $scope
                });
            };

            $scope.$on("event:sharePrescriptionsViaEmail", function (event, visitStartDate, visitUuid) {
                treatmentService.sharePrescriptions({patient: $scope.patient, visitDate: visitStartDate, visitUuid: visitUuid, printParams: printParams});
            });

            $scope.$on("event:downloadPrescriptionFromDashboard", function (event, visitStartDate, visitUuid) {
                visitActionsService.printPrescription($scope.patient, visitStartDate, visitUuid, printParams);
            });

            var cleanUpListener = $scope.$on('ngDialog.closing', function () {
                $("body").removeClass('ngdialog-open');
            });

            $scope.$on("$destroy", cleanUpListener);
        }]);

