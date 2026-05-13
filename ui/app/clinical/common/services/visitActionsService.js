'use strict';

angular.module('bahmni.clinical')
    .factory('visitActionsService', ['$http', '$q', '$rootScope', '$filter', 'spinner', 'messagingService', 'printer',
        function ($http, $q, $rootScope, $filter, spinner, messagingService, printer) {
            // ---- helpers -------------------------------------------------------------------

            var escapeHtml = function (text) {
                if (text === null || text === undefined) {
                    return '';
                }
                return String(text)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            };

            var formatDate = function (value) {
                if (!value) {
                    return '';
                }
                try {
                    return $filter('bahmniDate')(value) || '';
                } catch (e) {
                    return new Date(value).toLocaleDateString();
                }
            };

            var computeAge = function (birthdate, referenceDate) {
                if (!birthdate) {
                    return '';
                }
                var birth = new Date(birthdate);
                var ref = referenceDate ? new Date(referenceDate) : new Date();
                if (isNaN(birth.getTime()) || isNaN(ref.getTime())) {
                    return '';
                }
                var years = ref.getFullYear() - birth.getFullYear();
                var m = ref.getMonth() - birth.getMonth();
                if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) {
                    years--;
                }
                return years + ' yrs';
            };

            var safe = function (value, fallback) {
                if (value === null || value === undefined || value === '') {
                    return fallback || '';
                }
                return value;
            };

            var formatDrugDescription = function (drugOrder) {
                // The bahmnicore drug order REST response normally includes a pre-built
                // "dosingInstructions" object plus a "instructions" field. Fall back
                // gracefully when fields are missing.
                if (!drugOrder) {
                    return '';
                }
                if (drugOrder.dosingInstructionsAsString) {
                    return drugOrder.dosingInstructionsAsString;
                }
                var parts = [];
                var di = drugOrder.dosingInstructions || {};
                if (di.dose && di.doseUnits) {
                    parts.push(di.dose + ' ' + di.doseUnits);
                } else if (di.dose) {
                    parts.push(di.dose);
                }
                if (di.frequency) {
                    parts.push(di.frequency);
                }
                if (di.route) {
                    parts.push(di.route);
                }
                if (drugOrder.duration && drugOrder.durationUnits) {
                    parts.push('for ' + drugOrder.duration + ' ' + drugOrder.durationUnits);
                } else if (drugOrder.duration) {
                    parts.push('for ' + drugOrder.duration);
                }
                if (di.asNeeded) {
                    parts.push('SOS');
                }
                if (di.administrationInstructions) {
                    try {
                        var ai = typeof di.administrationInstructions === 'string'
                            ? JSON.parse(di.administrationInstructions)
                            : di.administrationInstructions;
                        if (ai && ai.instructions) {
                            parts.push(ai.instructions);
                        }
                        if (ai && ai.additionalInstructions) {
                            parts.push(ai.additionalInstructions);
                        }
                    } catch (e) {
                        parts.push(String(di.administrationInstructions));
                    }
                }
                return parts.join(', ');
            };

            var getDisplayName = function (drugOrder) {
                if (!drugOrder) {
                    return '';
                }
                if (drugOrder.drug && drugOrder.drug.name) {
                    return drugOrder.drug.name;
                }
                if (drugOrder.drugNonCoded) {
                    return drugOrder.drugNonCoded;
                }
                if (drugOrder.concept && drugOrder.concept.name) {
                    return drugOrder.concept.name;
                }
                if (drugOrder.display) {
                    return drugOrder.display.split(':')[0];
                }
                return '';
            };

            var buildHtml = function (patient, drugOrders, visitDate, printParams) {
                var locationName = (printParams && printParams.locationName) || ($rootScope.facilityLocation && $rootScope.facilityLocation.name) || 'PrimeCare Heart Clinic';
                var locationAddress = (printParams && printParams.locationAddress) || '';
                var title = (printParams && printParams.title) || 'Prescription';
                var logo = (printParams && printParams.logo) || '';
                var providerName = ($rootScope.currentUser && ($rootScope.currentUser.display || $rootScope.currentUser.username)) || '';
                if (drugOrders && drugOrders.length) {
                    var last = drugOrders[drugOrders.length - 1];
                    if (last && last.provider && last.provider.name) {
                        providerName = last.provider.name;
                    }
                }

                var patientName = safe(patient && patient.name, '');
                if (!patientName && patient) {
                    patientName = [patient.givenName, patient.middleName, patient.familyName].filter(function (p) { return !!p; }).join(' ');
                }
                var identifier = safe(patient && patient.identifier, '');
                var gender = '';
                if (patient && patient.genderText) {
                    // genderText is typically of form: " (Male) " — strip surrounding decorations.
                    gender = String(patient.genderText).replace(/[\s()]/g, '').trim();
                } else if (patient && patient.gender) {
                    gender = patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender;
                }
                var age = computeAge(patient && patient.birthdate, visitDate);

                var address = (patient && patient.address) || {};
                var addressLine = [address.cityVillage, address.countyDistrict].filter(function (p) { return !!p; }).join(', ');

                var rowsHtml = '';
                if (!drugOrders || drugOrders.length === 0) {
                    rowsHtml = '<tr><td colspan="5" style="text-align:center; padding:14px;">No medications prescribed for this visit.</td></tr>';
                } else {
                    drugOrders.forEach(function (d, idx) {
                        var notes = d.instructions || (d.dosingInstructions && d.dosingInstructions.administrationInstructions) || '';
                        if (typeof notes === 'object') {
                            try { notes = notes.instructions || ''; } catch (e) { notes = ''; }
                        }
                        rowsHtml += '<tr>'
                            + '<td style="text-align:center;">' + (idx + 1) + '</td>'
                            + '<td><strong>' + escapeHtml(getDisplayName(d)) + '</strong></td>'
                            + '<td>' + escapeHtml(formatDrugDescription(d)) + '</td>'
                            + '<td>' + escapeHtml(formatDate(d.effectiveStartDate || d.scheduledDate || d.dateActivated)) + '</td>'
                            + '<td>' + escapeHtml(d.quantity ? (d.quantity + (d.quantityUnits ? ' ' + d.quantityUnits : '')) : '') + '</td>'
                            + '</tr>';
                        if (notes) {
                            rowsHtml += '<tr><td></td><td colspan="4" style="font-style:italic; color:#444; padding-bottom:6px;">Note: ' + escapeHtml(notes) + '</td></tr>';
                        }
                    });
                }

                var logoHtml = logo
                    ? '<img src="' + escapeHtml(logo) + '" alt="logo" style="height:48px; width:48px; vertical-align:middle; margin-right:10px;"/>'
                    : '';

                return ''
                    + '<!doctype html><html><head><meta charset="utf-8"/><title>Prescription - ' + escapeHtml(patientName) + '</title>'
                    + '<style>'
                    + '  * { box-sizing: border-box; }'
                    + '  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; margin: 24px; }'
                    + '  .letterhead { border-bottom: 2px solid #b22222; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; }'
                    + '  .letterhead .clinic { flex: 1; }'
                    + '  .letterhead h1 { font-size: 22px; margin: 0; color: #b22222; }'
                    + '  .letterhead .sub { font-size: 13px; color: #555; margin-top: 2px; }'
                    + '  .meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }'
                    + '  .meta td { padding: 4px 6px; vertical-align: top; }'
                    + '  .meta td .label { color: #666; font-weight: 600; margin-right: 4px; }'
                    + '  h2.section { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #b22222; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }'
                    + '  table.rx { width: 100%; border-collapse: collapse; font-size: 13px; }'
                    + '  table.rx th { background: #fafafa; text-align: left; padding: 8px; border-bottom: 1px solid #ccc; }'
                    + '  table.rx td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }'
                    + '  .footer { margin-top: 36px; font-size: 13px; }'
                    + '  .signature { margin-top: 48px; display: flex; justify-content: space-between; }'
                    + '  .signature .sig-block { width: 45%; }'
                    + '  .signature .sig-line { border-top: 1px solid #333; margin-top: 36px; padding-top: 4px; text-align: center; font-size: 12px; color: #555; }'
                    + '  .disclaimer { margin-top: 18px; font-size: 11px; color: #777; text-align: center; }'
                    + '  @media print { body { margin: 12mm; } }'
                    + '</style></head><body>'
                    + '<div class="letterhead">' + logoHtml + '<div class="clinic">'
                    + '<h1>' + escapeHtml(locationName) + '</h1>'
                    + (locationAddress ? '<div class="sub">' + escapeHtml(locationAddress) + '</div>' : '')
                    + '<div class="sub">' + escapeHtml(title) + '</div>'
                    + '</div></div>'

                    + '<table class="meta"><tr>'
                    + '<td><span class="label">Patient:</span>' + escapeHtml(patientName) + '</td>'
                    + '<td><span class="label">Age / Sex:</span>' + escapeHtml(age + (gender ? ' / ' + gender : '')) + '</td>'
                    + '<td><span class="label">PHC #:</span>' + escapeHtml(identifier) + '</td>'
                    + '</tr><tr>'
                    + '<td><span class="label">Address:</span>' + escapeHtml(addressLine) + '</td>'
                    + '<td><span class="label">Visit Date:</span>' + escapeHtml(formatDate(visitDate)) + '</td>'
                    + '<td><span class="label">Printed:</span>' + escapeHtml(formatDate(new Date())) + '</td>'
                    + '</tr></table>'

                    + '<h2 class="section">Rx</h2>'
                    + '<table class="rx"><thead><tr>'
                    + '<th style="width:36px;">#</th>'
                    + '<th>Medication</th>'
                    + '<th>Dosage / Frequency / Duration</th>'
                    + '<th style="width:90px;">Start</th>'
                    + '<th style="width:90px;">Qty</th>'
                    + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>'

                    + '<div class="signature">'
                    + '<div class="sig-block"><div class="sig-line">Patient / Guardian</div></div>'
                    + '<div class="sig-block"><div class="sig-line">' + escapeHtml(providerName || 'Prescribing Clinician') + '</div></div>'
                    + '</div>'

                    + '<div class="disclaimer">This prescription was generated electronically by Bahmni. Please retain a copy for your records.</div>'
                    + '</body></html>';
            };

            var openPrintWindow = function (html, fileName) {
                // Open a new tab/window with the prescription HTML and trigger
                // window.print() automatically. The user can choose "Save as PDF"
                // from the browser print dialog as a second option.
                var w = window.open('', '_blank');
                if (!w) {
                    messagingService.showMessage('error', 'Could not open print window. Please allow pop-ups for this site.');
                    return;
                }
                w.document.open('text/html', 'replace');
                w.document.write(html);
                w.document.close();
                if (fileName) {
                    try { w.document.title = fileName; } catch (e) { /* ignore */ }
                }
                var triggerPrint = function () {
                    try {
                        w.focus();
                        w.print();
                    } catch (e) { /* ignore */ }
                };
                // Some browsers need a moment after document.close() before print works.
                if (w.document.readyState === 'complete') {
                    setTimeout(triggerPrint, 250);
                } else {
                    w.addEventListener('load', function () { setTimeout(triggerPrint, 100); });
                    // Fallback in case load never fires.
                    setTimeout(triggerPrint, 1500);
                }
            };

            var savePdf = function (html, fileName) {
                var deferred = $q.defer();
                if (typeof window.html2pdf !== 'function') {
                    // html2pdf isn't loaded — skip the save step; the print window
                    // still gives the user a "Save as PDF" option.
                    deferred.resolve();
                    return deferred.promise;
                }
                var holder = document.createElement('div');
                holder.style.position = 'fixed';
                holder.style.left = '-10000px';
                holder.style.top = '0';
                holder.innerHTML = html;
                document.body.appendChild(holder);

                var opts = {
                    margin: 10,
                    filename: fileName + '.pdf',
                    image: { type: 'jpeg', quality: 0.95 },
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                window.html2pdf().set(opts).from(holder).save().then(function () {
                    document.body.removeChild(holder);
                    deferred.resolve();
                }).catch(function (err) {
                    if (holder.parentNode) {
                        holder.parentNode.removeChild(holder);
                    }
                    deferred.reject(err);
                });
                return deferred.promise;
            };

            var fetchDrugOrders = function (patientUuid, visitUuid) {
                var deferred = $q.defer();
                var preferredLocale = ($rootScope.currentUser && $rootScope.currentUser.userProperties && $rootScope.currentUser.userProperties.defaultLocale) || 'en';
                $http.get(Bahmni.Common.Constants.bahmniDrugOrderUrl + '/prescribedAndActive', {
                    params: {
                        patientUuid: patientUuid,
                        numberOfVisits: 1,
                        getOtherActive: false,
                        visitUuids: visitUuid,
                        startDate: '',
                        endDate: '',
                        getEffectiveOrdersOnly: '',
                        preferredLocale: preferredLocale
                    },
                    withCredentials: true
                }).then(function (response) {
                    var data = response && response.data;
                    var orders = (data && data.visitDrugOrders) || [];
                    deferred.resolve(orders);
                }, function (err) {
                    deferred.reject(err);
                });
                return deferred.promise;
            };

            // ---- public API ----------------------------------------------------------------

            var printPrescription = function (patient, visitDate, visitUuid, printParams) {
                if (!patient || !patient.uuid) {
                    messagingService.showMessage('error', 'Cannot print prescription — patient context is missing.');
                    return;
                }
                var promise = fetchDrugOrders(patient.uuid, visitUuid).then(function (drugOrders) {
                    var html = buildHtml(patient, drugOrders, visitDate, printParams || {});
                    var safeName = (patient.givenName || patient.name || 'Patient').replace(/\s+/g, '_');
                    var fileName = 'Prescription_' + safeName + '_' + (patient.identifier || 'NA');
                    // Trigger PDF download first…
                    var saved = savePdf(html, fileName);
                    // …then open a print window so the user can also print/share.
                    saved.finally(function () {
                        openPrintWindow(html, fileName);
                    });
                    return saved;
                }, function () {
                    messagingService.showMessage('error', 'Failed to fetch drug orders for the prescription.');
                });
                spinner.forPromise(promise);
                return promise;
            };

            // Legacy path: some controllers (e.g. LatestPrescriptionPrintController) call the
            // service with a null printParams and rely on the old template-based renderer. Keep
            // a fallback that uses the existing printer pipeline so we don't regress those.
            var printPrescriptionViaTemplate = function (patient, visitDate, visitUuid, printParams) {
                printer.print('common/views/prescriptionPrint.html', {
                    patient: patient,
                    visitDate: visitDate,
                    visitUuid: visitUuid,
                    printParams: printParams
                });
            };

            return {
                printPrescription: printPrescription,
                printPrescriptionViaTemplate: printPrescriptionViaTemplate
            };
        }]);
