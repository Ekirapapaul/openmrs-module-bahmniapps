'use strict';

// PrimeCare external-lab capture panel (SRS §10.3).
//
// One self-contained panel covering all three integration points:
//   1. Print a lab requisition slip PDF for the visit's lab orders.
//   2. Upload an external-lab report (PDF / image) against this visit.
//   3. Hand-key numeric results for external lab orders so the
//      Bahmni trend graphs pick them up.
//
// Expects scope:
//   visit-uuid="..."   (required)
//   patient="..."      (required, object with a .uuid property)
//
// Uses externalLabService (see services/externalLabService.js) — same
// auth/cookie convention as claimsService.

angular.module('bahmni.clinical')
    .directive('externalLabPanel', ['externalLabService', 'orderService', 'orderTypeService',
        'messagingService', '$q',
        function (externalLabService, orderService, orderTypeService, messagingService, $q) {
            var controller = function ($scope) {
                $scope.collapsed = true;
                $scope.uploading = false;
                $scope.uploadProgress = 0;
                $scope.uploadNote = '';
                $scope.selectedFiles = [];
                $scope.fileError = null;
                $scope.savingResults = false;
                $scope.labOrders = [];
                $scope.resultDraft = {}; // orderUuid -> { numericValue, abnormal, comment }
                $scope.printing = false;
                $scope.selectedOrders = {}; // orderUuid -> bool

                var loadLabOrders = function () {
                    // Pull existing Lab Order rows for this visit so we can:
                    //  - let the user tick which orders go on the request slip
                    //  - show one numeric-results row per external-lab order
                    //
                    // TODO(primecare-deployment): once external-lab orders are
                    // tagged in OpenMRS (e.g. via an order attribute
                    // `provider=external`), filter $scope.labOrders to that
                    // subset only. Today we surface ALL lab orders in the
                    // visit and let the user pick.
                    var labOrderTypeUuid = orderTypeService.getOrderTypeUuid('Lab Order');
                    return orderService.getOrders({
                        patientUuid: $scope.patient.uuid,
                        orderTypeUuid: labOrderTypeUuid,
                        visitUuid: $scope.visitUuid,
                        includeObs: false,
                        numberOfVisits: 1
                    }).then(function (resp) {
                        $scope.labOrders = (resp.data || []).map(function (o) {
                            return {
                                uuid: o.orderUuid || o.uuid,
                                conceptUuid: o.concept && (o.concept.uuid || o.conceptUuid),
                                conceptName: o.conceptName ||
                                    (o.concept && (o.concept.shortName || o.concept.name)) ||
                                    'Lab order',
                                units: (o.concept && o.concept.units) || ''
                            };
                        }).filter(function (o) { return !!o.uuid; });
                    }, function () {
                        $scope.labOrders = [];
                    });
                };

                $scope.toggle = function () {
                    $scope.collapsed = !$scope.collapsed;
                    if (!$scope.collapsed && !$scope._loaded) {
                        $scope._loaded = true;
                        loadLabOrders();
                    }
                };

                // --- (1) Print Lab Request --------------------------------
                $scope.printRequest = function () {
                    var picked = [];
                    angular.forEach($scope.selectedOrders, function (v, k) {
                        if (v) { picked.push(k); }
                    });
                    $scope.printing = true;
                    externalLabService.requestSlip($scope.visitUuid, picked)
                        .then(function (resp) {
                            var blob = new Blob([resp.data], { type: 'application/pdf' });
                            var url = (window.URL || window.webkitURL).createObjectURL(blob);
                            // Trigger a browser save-as. Anchor-click is the
                            // most portable approach across the Bahmni-supported
                            // browser matrix (no popup blocker issues).
                            var a = document.createElement('a');
                            a.href = url;
                            a.download = 'lab-request-' + $scope.visitUuid + '.pdf';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(function () {
                                (window.URL || window.webkitURL).revokeObjectURL(url);
                            }, 1000);
                            messagingService.showMessage('info', 'Lab request slip downloaded.');
                        }, function (err) {
                            var msg = (err && err.data && err.data.error) ||
                                      'Failed to generate request slip.';
                            messagingService.showMessage('error', msg);
                        })
                        ['finally'](function () { $scope.printing = false; });
                };

                // --- (2) Upload external-lab document ---------------------
                $scope.onFilesPicked = function (fileList) {
                    $scope.fileError = null;
                    var arr = [];
                    for (var i = 0; i < fileList.length; i++) {
                        var f = fileList[i];
                        var err = externalLabService.validateFile(f);
                        if (err) { $scope.fileError = err; arr = []; break; }
                        arr.push(f);
                    }
                    $scope.selectedFiles = arr;
                    $scope.$applyAsync();
                };

                $scope.upload = function () {
                    if (!$scope.selectedFiles.length) {
                        $scope.fileError = 'Pick at least one file to upload.';
                        return;
                    }
                    $scope.uploading = true;
                    $scope.uploadProgress = 0;
                    externalLabService.uploadResult({
                        visitUuid: $scope.visitUuid,
                        patientUuid: $scope.patient.uuid,
                        orderUuid: $scope.uploadOrderUuid || undefined,
                        note: $scope.uploadNote || undefined
                    }, $scope.selectedFiles, function (evt) {
                        if (evt.lengthComputable) {
                            $scope.uploadProgress = Math.round((evt.loaded / evt.total) * 100);
                            $scope.$applyAsync();
                        }
                    }).then(function () {
                        messagingService.showMessage('info', 'External-lab document uploaded.');
                        $scope.selectedFiles = [];
                        $scope.uploadNote = '';
                        $scope.uploadOrderUuid = null;
                    }, function (err) {
                        var msg = (err && err.data && err.data.error) ||
                                  'Upload failed.';
                        messagingService.showMessage('error', msg);
                    })['finally'](function () {
                        $scope.uploading = false;
                        $scope.uploadProgress = 0;
                    });
                };

                // --- (3) Numeric results worksheet ------------------------
                $scope.saveResult = function (order) {
                    var draft = $scope.resultDraft[order.uuid];
                    if (!draft || draft.numericValue === undefined || draft.numericValue === null ||
                        draft.numericValue === '') {
                        messagingService.showMessage('error', 'Enter a numeric value first.');
                        return;
                    }
                    $scope.savingResults = true;
                    externalLabService.postResults(order.uuid, [{
                        conceptUuid: order.conceptUuid,
                        numericValue: Number(draft.numericValue),
                        abnormal: !!draft.abnormal,
                        comment: draft.comment || undefined
                    }]).then(function () {
                        messagingService.showMessage('info',
                            'Saved result for ' + order.conceptName + '.');
                        $scope.resultDraft[order.uuid] = {};
                    }, function (err) {
                        var msg = (err && err.data && err.data.error) ||
                                  'Failed to save result.';
                        messagingService.showMessage('error', msg);
                    })['finally'](function () { $scope.savingResults = false; });
                };
            };

            return {
                restrict: 'E',
                controller: controller,
                templateUrl: 'externalLab/views/externalLabPanel.html',
                scope: {
                    visitUuid: '@',
                    patient: '='
                }
            };
        }]);
