import ConflictNotice from "../ConflictNotice.jsx";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Files,
  MapPin,
  MapPinPen,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { buildGoogleMapsDirectionsUrl } from "../../lib/googleMapsNavigation.js";
import { timelineTypeLabels as typeLabels } from "../../lib/timelineTypeStyles.js";
import { timeToMinutes } from "../../lib/timelineTime.js";
import { transportCardTitle } from "../../lib/timelineTransportCategories.js";
import TransportCategoryIcon from "./TransportCategoryIcon.jsx";
import {
  OutlinedField,
  TimelineDurationField,
  TimelineSegmentedTimeField,
  TimelineTypeField,
  TransportCategoryField,
  TransportDurationField,
} from "./TimelineFormFields.jsx";
import { defaultTransportCategory, getDurationMinutes } from "./timelineItemRules.js";
import { FloatingOutlinedField, AutoGrowingTextarea } from "../FormControls.jsx";

export function timelineEditorFields({
  onCancelMapPointPick,
  onCancelMapSearchReplace,
  onStartMapSearchReplace,
  canPickMapPoint,
  isPickingMapPoint,
  isMapSearchReplaceActive,
  foreignSameDayDragActive,
  editingId,
  conflict,
  setConflict,
  timeError,
  mapUrlError,
  setMapUrlError,
  isResolvingMapUrl,
  isMapPointExpanded,
  setIsMapPointExpanded,
  durationInput,
  setDurationInput,
  setIsAlternativeDeleteConfirmOpen,
  alternativeErrorByItem,
  form,
  setForm,
  canMutateThisDay,
  foreignDragSaveBlockedMessage,
  visitDurationRef,
  closeEditor,
  submit,
  isAlternativeEditor,
  activeVisitForm,
  updateActiveVisitForm,
  alternativeDestination,
  transportEndpointItems,
  renderTransportNavigationControl,
  toggleMapPointPick,
  updateVisitTime,
  commitDurationInput,
  applyMapUrlDraft,
  editorMapsUrl,
  openAlternativeEditor,
  returnToMainEditor,
}) {
  function renderTransportEditorForm() {
    const category = form.transport_category || defaultTransportCategory;
    const editorRouteItem = { ...form, id: editingId || "transport-editor" };
    const { fromItem, toItem } = transportEndpointItems(editorRouteItem);
    const editorNavigationUrl = buildGoogleMapsDirectionsUrl({
      fromItem,
      toItem,
      transportCategory: category,
    });
    const editorHeadingTitle = transportCardTitle(form) || "新增交通資訊";

    return (
      <form autoComplete="off" className="item-form transport-editor-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="transport" />
        <input name="type" type="hidden" value="transport" />
        <input name="start_time" type="hidden" value={form.start_time || ""} />
        <input name="from_item_id" type="hidden" value={form.from_item_id || ""} />
        <input name="to_item_id" type="hidden" value={form.to_item_id || ""} />
        <input name="from_snapshot_start_time" type="hidden" value={form.from_snapshot_start_time || ""} />
        <input name="from_snapshot_end_time" type="hidden" value={form.from_snapshot_end_time || ""} />
        <input name="from_snapshot_destination" type="hidden" value={form.from_snapshot_destination || ""} />
        <input name="to_snapshot_start_time" type="hidden" value={form.to_snapshot_start_time || ""} />
        <input name="to_snapshot_end_time" type="hidden" value={form.to_snapshot_end_time || ""} />
        <input name="to_snapshot_destination" type="hidden" value={form.to_snapshot_destination || ""} />
        {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
        {foreignSameDayDragActive ? (
          <div className="notice inline-error" role="alert">
            <span>{foreignDragSaveBlockedMessage}</span>
          </div>
        ) : null}
        <div className="transport-editor-heading">
          <span className="transport-icon" aria-hidden="true">
            <TransportCategoryIcon category={category} />
          </span>
          <strong>{editorHeadingTitle}</strong>
        </div>
        <div className="transport-editor-edit-mode">
          <div className="form-grid wide transport-editor-route-row">
            <TransportCategoryField
              value={category}
              onValueChange={(transportCategory) => setForm({ ...form, transport_category: transportCategory })}
            />
            <TransportDurationField
              value={form.transport_duration_minutes}
              onValueChange={(transportDurationMinutes) =>
                setForm({ ...form, transport_duration_minutes: transportDurationMinutes })
              }
            />
            {renderTransportNavigationControl(editorNavigationUrl, "mini-button transport-navigation-button transport-editor-navigation-button")}
          </div>
          <FloatingOutlinedField className="transport-editor-name-field" label="交通名稱">
            <input
              aria-label="交通名稱"
              autoComplete="off"
              name="transport_name"
              placeholder="交通名稱"
              value={form.transport_name}
              onChange={(event) => setForm({ ...form, transport_name: event.target.value, title: event.target.value })}
            />
          </FloatingOutlinedField>
          <FloatingOutlinedField className="transport-editor-note-field" label="備註">
            <AutoGrowingTextarea
              aria-label="備註"
              autoComplete="off"
              name="transport_note"
              placeholder="備註"
              rows="2"
              value={form.transport_note}
              onChange={(event) =>
                setForm({
                  ...form,
                  transport_note: event.target.value,
                  transportation_note: event.target.value,
                  note: event.target.value,
                  description: event.target.value,
                })
              }
            />
          </FloatingOutlinedField>
          <div className="transport-editor-footer-actions navigation-only">
            <div className="transport-editor-save-actions">
              <button className="primary-button compact transport-editor-action-button" disabled={!canMutateThisDay} type="submit">
                保存
              </button>
              <button className="ghost-button compact transport-editor-action-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>
                取消
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  function renderEditorMapSettings({ includeAlternative = false } = {}) {
    const pendingAlternative = form.alternative_deleted ? null : form.alternative_draft;
    const isMapPointBodyVisible = isAlternativeEditor || isMapPointExpanded;
    return (
      <div className={`visit-map-point-section${isMapPointBodyVisible ? " expanded" : ""}${isAlternativeEditor ? " always-expanded" : ""}`}>
        <div className="visit-map-point-header">
          {isAlternativeEditor ? (
            <div className="visit-settings-heading visit-map-point-static-title">
              <MapPin aria-hidden="true" />
              <span>地圖點位</span>
            </div>
          ) : (
            <button className="visit-map-point-toggle" type="button" aria-expanded={isMapPointExpanded} onClick={() => setIsMapPointExpanded((current) => !current)}>
              <ChevronRight aria-hidden="true" />
              <span>{includeAlternative ? "更多設定" : "更改地點"}</span>
            </button>
          )}
          <a
            aria-disabled={!editorMapsUrl}
            className={`ghost-button compact visit-maps-link${editorMapsUrl ? "" : " disabled"}`}
            href={editorMapsUrl || undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { if (!editorMapsUrl) event.preventDefault(); }}
          >
            <span>Google Map</span>
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
        {isMapPointBodyVisible ? (
          <div className="visit-map-point-body">
            {!isAlternativeEditor ? (
              <div className="visit-settings-heading">
                <MapPin aria-hidden="true" />
                <span>地圖點位</span>
              </div>
            ) : null}
            <div className="visit-map-point-actions">
              <button className={`ghost-button compact map-point-picker-button${isPickingMapPoint ? " active" : ""}`} disabled={!canPickMapPoint} type="button" onClick={toggleMapPointPick}>
                <MapPinPen aria-hidden="true" />
                <span>{isPickingMapPoint ? "取消選點" : "調整點位"}</span>
              </button>
              <button
                className={`ghost-button compact visit-map-search-replace-button${isMapSearchReplaceActive ? " active" : ""}`}
                disabled={!canPickMapPoint}
                type="button"
                onClick={() => {
                  onCancelMapPointPick?.();
                  if (isMapSearchReplaceActive) onCancelMapSearchReplace?.();
                  else onStartMapSearchReplace?.();
                }}
              >
                <Search aria-hidden="true" />
                <span>{isMapSearchReplaceActive ? "取消搜尋" : "搜尋替換"}</span>
              </button>
            </div>
            <OutlinedField className="visit-map-url-editor" invalid={Boolean(mapUrlError)} label="Google Maps URL">
              <input
                aria-invalid={Boolean(mapUrlError)}
                aria-label="Google Maps URL"
                autoComplete="off"
                name={includeAlternative ? "map_url" : undefined}
                placeholder="貼上 Google Maps 連結"
                value={activeVisitForm.map_url || ""}
                onChange={(event) => { setMapUrlError(""); updateActiveVisitForm({ map_url: event.target.value }); }}
                onBlur={() => { if (!isAlternativeEditor) void applyMapUrlDraft(); }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  void applyMapUrlDraft();
                }}
              />
            </OutlinedField>
            {mapUrlError ? <span className="field-inline-error visit-map-url-error" role="alert">{mapUrlError}</span> : null}
            {includeAlternative ? (
              <div className="visit-alternative-settings">
                <div className="visit-settings-divider" />
                <div className="visit-settings-heading">
                  <Files aria-hidden="true" />
                  <span>備案</span>
                </div>
                {pendingAlternative ? (
                  <button className="visit-alternative-summary" type="button" onClick={openAlternativeEditor}>
                    <span>
                      {`${typeLabels[pendingAlternative.type] || typeLabels.attraction} ・ ${alternativeDestination(pendingAlternative)}`}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ) : (
                  <button className="visit-alternative-summary visit-alternative-create-summary" type="button" onClick={openAlternativeEditor}>
                    <span><Plus aria-hidden="true" />建立備案</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : includeAlternative ? <input name="map_url" type="hidden" value={form.map_url} /> : null}
      </div>
    );
  }

  function renderVisitEditorForm() {
    const alternativeError = alternativeErrorByItem[editingId || "new"];
    const originalDestination = form.location_name || form.location || form.title || "未命名行程";
    return (
      <form autoComplete="off" className="item-form" onSubmit={submit}>
        <input name="item_type" type="hidden" value="visit" />
        {isAlternativeEditor ? (
          <>
            <div className="alternative-editor-heading">
              <span className="form-mode-label">{form.alternative_id ? "編輯備案" : "新增備案"}</span>
              <span className="alternative-origin-label">{`原行程：${originalDestination}`}</span>
            </div>
            {alternativeError ? (
              <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div>
            ) : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={activeVisitForm.type || "attraction"} onValueChange={(type) => updateActiveVisitForm({ type })} />
              <OutlinedField className="destination-field" label="備案目的地">
                <input
                  aria-label="備案目的地"
                  autoComplete="off"
                  placeholder="請輸入備案目的地"
                  required
                  value={activeVisitForm.location_name || ""}
                  onChange={(event) => updateActiveVisitForm({ title: event.target.value, location_name: event.target.value })}
                />
              </OutlinedField>
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea
                aria-label="備註"
                autoComplete="off"
                placeholder="備註"
                rows="2"
                value={activeVisitForm.description || ""}
                onChange={(event) => updateActiveVisitForm({ description: event.target.value })}
              />
            </FloatingOutlinedField>
            {renderEditorMapSettings()}
            <div className="form-actions alternative-editor-actions">
              {form.alternative_id ? (
                <button className="ghost-button danger compact alternative-editor-delete-button" type="button" onClick={() => setIsAlternativeDeleteConfirmOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  <span>刪除備案</span>
                </button>
              ) : null}
              <button className="ghost-button compact alternative-editor-return-button" type="button" onClick={returnToMainEditor}>
                <ChevronLeft aria-hidden="true" />
                <span>返回主行程</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-mode-label">{editingId ? "編輯行程" : "新增行程"}</div>
            {conflict ? <ConflictNotice onKeep={() => setConflict(false)} onLatest={() => closeEditor(true)} /> : null}
            {timeError ? <div className="notice inline-error" role="alert"><span>{timeError}</span></div> : null}
            {alternativeError ? <div className="notice inline-error" role="alert"><span>{alternativeError}</span></div> : null}
            {foreignSameDayDragActive ? <div className="notice inline-error" role="alert"><span>{foreignDragSaveBlockedMessage}</span></div> : null}
            <div className="visit-editor-primary-row">
              <TimelineTypeField value={form.type} onValueChange={(type) => setForm({ ...form, type })} />
              <OutlinedField className="destination-field" label="目的地">
                <input aria-label="目的地" autoComplete="off" placeholder="請輸入目的地名稱" name="location_name" required value={form.location_name || form.location} onChange={(event) => setForm({ ...form, title: event.target.value, location: event.target.value, location_name: event.target.value })} />
              </OutlinedField>
            </div>
            <div className="visit-editor-time-row">
              <TimelineSegmentedTimeField label="開始" name="start_time" value={form.start_time} onValueChange={(nextValue) => updateVisitTime("start_time", nextValue, getDurationMinutes(form.start_time, form.end_time))} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineSegmentedTimeField label="結束" name="end_time" value={form.end_time} onValueChange={(nextValue) => updateVisitTime("end_time", nextValue)} />
              <span className="visit-time-link" aria-hidden="true" />
              <TimelineDurationField disabled={!form.start_time} inputRef={visitDurationRef} maxMinutes={Math.max(0, 24 * 60 - 5 - (timeToMinutes(form.start_time) || 0))} value={durationInput} onCommit={commitDurationInput} onInputChange={setDurationInput} />
            </div>
            <FloatingOutlinedField className="full-label visit-note-field" label="備註">
              <AutoGrowingTextarea aria-label="備註" autoComplete="off" name="description" placeholder="備註" rows="2" value={form.description || form.note} onChange={(event) => setForm({ ...form, note: event.target.value, description: event.target.value })} />
            </FloatingOutlinedField>
            {renderEditorMapSettings({ includeAlternative: true })}
            <div className="form-actions">
              <button className="ghost-button item-form-cancel-button" type="button" onClick={() => closeEditor()}>取消</button>
              <button className="primary-button compact" disabled={!canMutateThisDay || isResolvingMapUrl} type="submit">儲存</button>
            </div>
          </>
        )}
      </form>
    );
  }

  return { renderTransportEditorForm, renderVisitEditorForm };
}
