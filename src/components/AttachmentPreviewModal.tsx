import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "@e965/xlsx";
import css from "./AttachmentPreviewModal.module.css";
import { getAttachmentPreviewKind, getPreviewMimeType } from "../utils/attachments";
import { downloadAttachment, fetchAttachmentBlobForPreview } from "../utils/attachmentDownload";

const EXCEL_MAX_ROWS = 200;
const EXCEL_MAX_COLS = 50;

interface PreviewableAttachment {
  readonly fileName?: string;
  readonly filepath?: string;
}

interface AttachmentPreviewModalProps {
  packageName: string;
  attachments: PreviewableAttachment[];
  onClose: () => void;
}

interface ExcelSheetData {
  rows: string[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "image"; blobUrl: string }
  | { status: "pdf"; blobUrl: string }
  | { status: "excel"; workbook: XLSX.WorkBook; activeSheetName: string }
  | { status: "none" };

/** Converts one sheet's cells into a table-ready 2D array, capped in size. */
function computeSheetData(workbook: XLSX.WorkBook, sheetName: string): ExcelSheetData {
  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const truncatedRows = allRows.length > EXCEL_MAX_ROWS;
  const rows = allRows.slice(0, EXCEL_MAX_ROWS);
  const truncatedCols = rows.some((r) => r.length > EXCEL_MAX_COLS);
  const trimmedRows = rows.map((r) => r.slice(0, EXCEL_MAX_COLS));
  return { rows: trimmedRows, truncatedRows, truncatedCols };
}

/**
 * Modal for browsing a package's attachments and previewing one at a time.
 * Images and PDFs render inline (browser-native); spreadsheets are parsed
 * client-side into an HTML table; everything else falls back to a download
 * prompt since there's no in-browser renderer for it.
 */
function AttachmentPreviewModal({
  packageName,
  attachments,
  onClose,
}: AttachmentPreviewModalProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // Per-sheet table data, computed lazily on tab click rather than for every
  // sheet up front. Keyed by sheet name; reset whenever a new attachment's
  // workbook is parsed. A ref (not state) since populating it shouldn't by
  // itself trigger a re-render — only `activeSheetName` needs to.
  const sheetDataCacheRef = useRef<Map<string, ExcelSheetData>>(new Map());

  const selected = selectedIndex != null ? attachments[selectedIndex] : null;

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const fileName = selected.fileName ?? selected.filepath ?? "";
    const kind = getAttachmentPreviewKind(fileName);

    setPreview({ status: "loading" });

    (async () => {
      try {
        if (kind === "none") {
          if (!cancelled) setPreview({ status: "none" });
          return;
        }

        const blob = await fetchAttachmentBlobForPreview(selected);
        if (cancelled) return;

        if (kind === "image" || kind === "pdf") {
          // The data-proxy response doesn't reliably set a correct
          // Content-Type, so browsers can't tell the blob is renderable
          // in an <iframe>/<img> and fall back to downloading it instead.
          // Re-wrap with the type inferred from the file's extension.
          const mimeType = getPreviewMimeType(fileName);
          const typedBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
          objectUrl = URL.createObjectURL(typedBlob);
          setPreview({ status: kind, blobUrl: objectUrl });
          return;
        }

        // kind === "excel" — XLSX.read() parses every sheet's raw cell data
        // up front (that's unavoidable), but converting a sheet into
        // table-ready rows (computeSheetData) is deferred per-sheet: only
        // the first sheet is converted now, others convert on tab click.
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        const workbook = XLSX.read(buffer, { type: "array" });
        sheetDataCacheRef.current = new Map();
        if (!cancelled) {
          setPreview({ status: "excel", workbook, activeSheetName: workbook.SheetNames[0] });
        }
      } catch (e) {
        if (!cancelled) {
          setPreview({ status: "error", message: e instanceof Error ? e.message : "Failed to load preview" });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  const handleSelectSheet = (sheetName: string) => {
    setPreview((prev) => (prev && prev.status === "excel" ? { ...prev, activeSheetName: sheetName } : prev));
  };

  const [downloadingFallback, setDownloadingFallback] = useState(false);
  const handleDownloadSelected = async () => {
    if (!selected || downloadingFallback) return;
    setDownloadingFallback(true);
    try {
      await downloadAttachment(selected);
    } catch (e) {
      console.error("Failed to download attachment:", e);
    } finally {
      setDownloadingFallback(false);
    }
  };

  const previewBody = useMemo(() => {
    if (!selected) {
      return <div className={css.emptyState}>Select an attachment to preview it.</div>;
    }
    if (!preview || preview.status === "loading") {
      return <div className={css.emptyState}>Loading preview…</div>;
    }
    if (preview.status === "error") {
      return <div className={`${css.emptyState} ${css.emptyStateError}`}>Error: {preview.message}</div>;
    }
    if (preview.status === "image") {
      return <img className={css.previewImage} src={preview.blobUrl} alt={selected.fileName ?? "Attachment preview"} />;
    }
    if (preview.status === "pdf") {
      return <iframe className={css.previewFrame} src={preview.blobUrl} title={selected.fileName ?? "Attachment preview"} />;
    }
    if (preview.status === "excel") {
      const sheetNames = preview.workbook.SheetNames;
      const cache = sheetDataCacheRef.current;
      let sheetData = cache.get(preview.activeSheetName);
      if (!sheetData) {
        sheetData = computeSheetData(preview.workbook, preview.activeSheetName);
        cache.set(preview.activeSheetName, sheetData);
      }
      return (
        <div className={css.excelWrap}>
          {sheetNames.length > 1 ? (
            <div className={css.excelSheetTabs}>
              {sheetNames.map((name) => (
                <button
                  key={name}
                  className={`${css.excelSheetTab} ${name === preview.activeSheetName ? css.excelSheetTabActive : ""}`}
                  onClick={() => handleSelectSheet(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <div className={css.excelSheetName}>Sheet: {preview.activeSheetName}</div>
          )}
          <div className={css.excelTableWrap}>
            <table className={css.excelTable}>
              <tbody>
                {sheetData.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(sheetData.truncatedRows || sheetData.truncatedCols) && (
            <div className={css.excelTruncatedNote}>
              Showing the first {EXCEL_MAX_ROWS} rows{sheetData.truncatedCols ? ` and ${EXCEL_MAX_COLS} columns` : ""} — download the file to see the rest.
            </div>
          )}
        </div>
      );
    }
    // status === "none"
    return (
      <div className={css.noPreview}>
        <div className={css.noPreviewIcon}>📎</div>
        <div className={css.noPreviewText}>No preview available for this file type.</div>
        <button className={css.downloadFallbackButton} onClick={handleDownloadSelected} disabled={downloadingFallback}>
          {downloadingFallback ? "Downloading…" : "Download"}
        </button>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, preview, downloadingFallback]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <div className={css.header}>
          <div className={css.title}>Attachments — {packageName}</div>
          <button className={css.closeButton} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={css.body}>
          <div className={css.list}>
            {attachments.length === 0 ? (
              <div className={css.emptyMessage}>No attachments found.</div>
            ) : (
              attachments.map((att, i) => {
                const fileName = att.fileName ?? att.filepath ?? "Unnamed file";
                return (
                  <button
                    key={att.filepath ?? i}
                    className={`${css.item} ${selectedIndex === i ? css.itemSelected : ""}`}
                    onClick={() => setSelectedIndex(i)}
                  >
                    <span className={css.itemName}>{fileName}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className={css.previewPane}>{previewBody}</div>
        </div>
      </div>
    </div>
  );
}

export default AttachmentPreviewModal;
