import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  Experiment,
  ExperimentBlock,
  ExperimentRevision,
  HeadingContent,
  ParagraphContent,
  ResultContent,
  ListContent,
  ChecklistContent,
  ParameterBlockContent,
  TableContent,
  ImageContent,
  AttachmentContent,
  ProtocolBlockContent,
  CalloutContent,
  ReferenceContent,
  RelatedExperimentContent,
  CodeContent,
  ProtocolDevBlockEntry,
} from '@/lib/types';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
  assembleLivePdfModel,
  assembleRevisionPdfModel,
  pdfFileName,
  type PdfModel,
  type SignatureRow,
} from '@/lib/pdfModel';

const SIGNATURE_SELECT = '*, signer:profiles!signatures_signer_id_fkey(id, display_name)';

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function formatUtc(iso: string, pattern = 'yyyy-MM-dd HH:mm:ss'): string {
  const d = new Date(iso);
  return format(new Date(d.getTime() + d.getTimezoneOffset() * 60000), pattern) + ' UTC';
}

function renderPdf(model: PdfModel) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const record = model.record;
  const footerLabel =
    record.kind === 'live'
      ? `${model.experimentId} - working copy (unsigned)`
      : `${model.experimentId} - revision v${record.revisionNumber}`;
  let y = margin;

  function addPage() {
    doc.addPage();
    y = margin;
    addFooter();
  }

  function checkSpace(needed: number) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + needed > pageHeight - 25) {
      addPage();
    }
  }

  function addFooter() {
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Exported: ${formatUtc(new Date().toISOString())}`, margin, pageHeight - 10);
    doc.text(footerLabel, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }

  function writeWrapped(text: string, x: number, lineHeight: number) {
    const lines = doc.splitTextToSize(text, pageWidth - margin - x);
    for (const line of lines) {
      checkSpace(lineHeight);
      doc.text(line, x, y);
      y += lineHeight;
    }
  }

  addFooter();

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(model.experimentId, margin, y);
  y += 6;

  doc.setFontSize(18);
  doc.setTextColor(30);
  const titleLines = doc.splitTextToSize(model.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8 + 4;

  const metaRows: [string, string][] = [];
  if (model.notebookName) metaRows.push(['Notebook', model.notebookName]);
  if (record.kind === 'live') {
    metaRows.push(['Record', 'Working copy (not a signed record)']);
  } else {
    metaRows.push(['Record', record.signature ? `Signed revision v${record.revisionNumber}` : `Revision v${record.revisionNumber}`]);
    metaRows.push(['Revision created', formatUtc(record.createdAt, 'yyyy-MM-dd HH:mm')]);
  }
  metaRows.push(['Experiment Date', model.experimentDate || '']);
  if (model.authorName) metaRows.push(['Author', model.authorName]);
  if (model.tags.length > 0) metaRows.push(['Tags', model.tags.join(', ')]);
  if (record.kind === 'revision') metaRows.push(['Content hash', record.contentHash]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: metaRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 35, textColor: [100, 100, 100] },
      1: { textColor: [30, 30, 30], overflow: 'linebreak' },
    },
  });

  y = (doc as unknown as Record<string, { finalY: number }>).lastAutoTable.finalY + 8;

  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  for (const block of model.blocks) {
    switch (block.type) {
      case 'heading': {
        const c = block.content as HeadingContent;
        checkSpace(12);
        const level = c.level || 2;
        const sizes: Record<number, number> = { 1: 16, 2: 14, 3: 12 };
        doc.setFontSize(sizes[level] || 12);
        doc.setTextColor(20);
        const text = stripHtml(c.html || '');
        if (text) {
          const lines = doc.splitTextToSize(text, contentWidth);
          doc.text(lines, margin, y);
          y += lines.length * (sizes[level] || 12) * 0.5 + 4;
        }
        break;
      }

      case 'paragraph': {
        const c = block.content as ParagraphContent;
        const text = stripHtml(c.html || '');
        if (!text) break;
        checkSpace(10);
        doc.setFontSize(10);
        doc.setTextColor(50);
        const lines = doc.splitTextToSize(text, contentWidth);
        for (const line of lines) {
          checkSpace(5);
          doc.text(line, margin, y);
          y += 5;
        }
        y += 3;
        break;
      }

      case 'result': {
        const c = block.content as ResultContent;
        const text = stripHtml(c.html || '');
        if (!text) break;
        checkSpace(10);
        if (c.label) {
          doc.setFontSize(11);
          doc.setTextColor(20, 120, 20);
          doc.text(c.label, margin, y);
          y += 6;
        }
        doc.setFontSize(10);
        doc.setTextColor(50);
        const lines = doc.splitTextToSize(text, contentWidth);
        for (const line of lines) {
          checkSpace(5);
          doc.text(line, margin, y);
          y += 5;
        }
        y += 3;
        break;
      }

      case 'list': {
        const c = block.content as ListContent;
        const items: string[] = c.items || [];
        const isNumbered = c.type === 'numbered';
        doc.setFontSize(10);
        doc.setTextColor(50);
        for (let i = 0; i < items.length; i++) {
          checkSpace(6);
          const prefix = isNumbered ? `${i + 1}. ` : '\u2022 ';
          const text = doc.splitTextToSize(prefix + items[i], contentWidth - 8);
          doc.text(text, margin + 4, y);
          y += text.length * 5 + 1;
        }
        y += 3;
        break;
      }

      case 'checklist': {
        const c = block.content as ChecklistContent;
        const items = c.items || [];
        doc.setFontSize(10);
        doc.setTextColor(50);
        for (const item of items) {
          checkSpace(6);
          const prefix = item.checked ? '[\u2713] ' : '[ ] ';
          doc.text(prefix + item.text, margin + 4, y);
          y += 5;
        }
        y += 3;
        break;
      }

      case 'parameters': {
        const c = block.content as ParameterBlockContent;
        const params = c.parameters || [];
        if (params.length === 0) break;
        checkSpace(10);
        doc.setFontSize(11);
        doc.setTextColor(20);
        doc.text('Parameters', margin, y);
        y += 6;

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Parameter', 'Value', 'Unit', 'Description']],
          body: params.map(p => [p.name, p.value, p.unit, p.description || '']),
          theme: 'grid',
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold' },
        });
        y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
        break;
      }

      case 'table': {
        const c = block.content as TableContent;
        const cols = c.columns || [];
        const tRows: string[][] = c.rows || [];
        if (cols.length === 0) break;
        checkSpace(10);

        if (c.caption) {
          doc.setFontSize(9);
          doc.setTextColor(100);
          doc.text(c.caption, margin, y);
          y += 5;
        }

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [cols.map(col => col.name)],
          body: tRows,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold' },
        });
        y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
        break;
      }

      case 'image': {
        const c = block.content as ImageContent;
        if (!c.url) break;
        checkSpace(60);
        try {
          const imgWidth = Math.min(contentWidth, 140);
          doc.addImage(c.url, 'JPEG', margin, y, imgWidth, imgWidth * 0.6);
          y += imgWidth * 0.6 + 3;
          if (c.caption) {
            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(c.caption, margin, y);
            y += 5;
          }
        } catch {
          doc.setFontSize(9);
          doc.setTextColor(150);
          doc.text('[Image could not be embedded]', margin, y);
          y += 5;
        }
        y += 3;
        break;
      }

      case 'attachment': {
        const c = block.content as AttachmentContent;
        if (!c.filename) break;
        checkSpace(8);
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(`Attachment: ${c.displayName || c.filename}`, margin + 4, y);
        y += 5;
        if (c.caption) {
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(c.caption, margin + 8, y);
          y += 4;
        }
        y += 2;
        break;
      }

      case 'protocol': {
        const c = block.content as ProtocolBlockContent;
        checkSpace(15);
        doc.setFontSize(11);
        doc.setTextColor(20);
        doc.text(
          `Protocol: ${c.protocol_name || 'Protocol'} (v${c.version_number || '?'})`,
          margin, y
        );
        y += 7;

        const steps = c.steps || [];
        const deviations: ProtocolDevBlockEntry[] = c.deviations || [];
        for (let i = 0; i < steps.length; i++) {
          checkSpace(12);
          doc.setFontSize(9);
          doc.setTextColor(60);
          const stepText = `${i + 1}. ${steps[i].instruction || ''}`;
          const lines = doc.splitTextToSize(stepText, contentWidth - 8);
          doc.text(lines, margin + 4, y);
          y += lines.length * 4 + 2;

          if (steps[i].duration) {
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Duration: ${steps[i].duration}`, margin + 8, y);
            y += 4;
          }

          const dev = deviations.find((d) => d.step_index === i);
          if (dev) {
            doc.setFontSize(8);
            doc.setTextColor(180, 100, 0);
            doc.text(`DEVIATION: ${dev.actual_value}`, margin + 8, y);
            y += 4;
            if (dev.reason) {
              doc.text(`Reason: ${dev.reason}`, margin + 12, y);
              y += 4;
            }
          }
        }
        y += 4;
        break;
      }

      case 'callout': {
        const c = block.content as CalloutContent;
        const text = stripHtml(c.html || '');
        if (!text) break;
        checkSpace(10);
        const typeLabels: Record<string, string> = { note: 'Note', warning: 'Warning', tip: 'Tip', danger: 'Important' };
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`[${typeLabels[c.type] || 'Note'}]`, margin, y);
        y += 5;
        doc.setFontSize(10);
        doc.setTextColor(60);
        const lines = doc.splitTextToSize(text, contentWidth - 8);
        doc.text(lines, margin + 4, y);
        y += lines.length * 5 + 4;
        break;
      }

      case 'reference': {
        const c = block.content as ReferenceContent;
        checkSpace(10);
        doc.setFontSize(9);
        doc.setTextColor(60);
        let refText = '';
        if (c.citation) refText = c.citation;
        else if (c.title) refText = c.title;
        if (c.doi) refText += ` DOI: ${c.doi}`;
        if (c.url && !c.doi) refText += ` ${c.url}`;
        if (refText) {
          const lines = doc.splitTextToSize(refText, contentWidth);
          doc.text(lines, margin + 4, y);
          y += lines.length * 4 + 3;
        }
        break;
      }

      case 'related_experiment': {
        const c = block.content as RelatedExperimentContent;
        checkSpace(6);
        doc.setFontSize(9);
        doc.setTextColor(60);
        doc.text(
          `Related: ${c.experiment_display_id || ''} \u2014 ${c.title || ''}`,
          margin + 4, y
        );
        y += 6;
        break;
      }

      case 'code': {
        const c = block.content as CodeContent;
        const code = c.code || '';
        if (!code) break;
        checkSpace(10);
        doc.setFontSize(8);
        doc.setTextColor(60);
        const lines = doc.splitTextToSize(code, contentWidth - 8);
        doc.text(lines, margin + 4, y);
        y += lines.length * 3.5 + 4;
        break;
      }

      case 'divider': {
        checkSpace(6);
        doc.setDrawColor(200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;
        break;
      }

      default:
        break;
    }
  }

  if (record.kind === 'revision' && record.signature) {
    const sig = record.signature;
    checkSpace(40);
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text('Electronic Signature', margin, y);
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(60);
    writeWrapped(`Signer: ${sig.signerName}`, margin + 4, 5);
    writeWrapped(`Signed at: ${formatUtc(sig.signedAt)}`, margin + 4, 5);
    writeWrapped(`Signed revision: v${sig.revisionNumber}`, margin + 4, 5);
    writeWrapped(`Content hash (SHA-256): ${sig.contentHash}`, margin + 4, 5);
    writeWrapped(`Declaration: ${sig.declaration}`, margin + 4, 5);
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  doc.save(pdfFileName(model));
}

export function exportLivePdf(experiment: Experiment, blocks: ExperimentBlock[]) {
  renderPdf(assembleLivePdfModel(experiment, blocks));
}

async function signatureForRevision(revisionId: string): Promise<SignatureRow | null> {
  const { data, error } = await supabase
    .from('signatures')
    .select(SIGNATURE_SELECT)
    .eq('experiment_revision_id', revisionId)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Could not load the signature for this revision');
  return (data as SignatureRow | null) ?? null;
}

export async function exportRevisionPdf(experiment: Experiment, revision: ExperimentRevision) {
  const signature = await signatureForRevision(revision.id);
  renderPdf(assembleRevisionPdfModel(experiment, revision, signature));
}

export async function exportSignedRevisionPdf(experiment: Experiment) {
  const { data: signature, error: sigError } = await supabase
    .from('signatures')
    .select(SIGNATURE_SELECT)
    .eq('experiment_id', experiment.id)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sigError) throw new Error('Could not load the signature for this experiment');
  const sig = signature as SignatureRow | null;
  if (!sig?.experiment_revision_id) throw new Error('No signed revision was found for this experiment');

  const { data: revision, error: revError } = await supabase
    .from('experiment_revisions')
    .select('*')
    .eq('id', sig.experiment_revision_id)
    .eq('experiment_id', experiment.id)
    .single();
  if (revError || !revision) throw new Error('Could not load the signed revision');

  renderPdf(assembleRevisionPdfModel(experiment, revision as ExperimentRevision, sig));
}
