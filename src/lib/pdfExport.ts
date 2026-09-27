import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Experiment, ExperimentBlock } from '@/lib/types';
import { format } from 'date-fns';

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export async function exportExperimentPdf(
  experiment: Experiment,
  blocks: ExperimentBlock[],
  options?: {
    signatures?: Array<{ signer?: { display_name: string }; revision_number: number; signed_at: string; declaration: string }>;
    reviews?: Array<{ reviewer?: { display_name: string }; status: string; reviewed_at: string; comment?: string }>;
  }
) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
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
    const pageCount = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    doc.text(
      `Exported: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')} UTC`,
      margin,
      pageHeight - 10
    );
    doc.text(
      experiment.experiment_id,
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
  }

  addFooter();

  // Title section
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(experiment.experiment_id, margin, y);
  y += 6;

  doc.setFontSize(18);
  doc.setTextColor(30);
  const titleLines = doc.splitTextToSize(experiment.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8 + 4;

  // Metadata table
  doc.setFontSize(9);
  doc.setTextColor(80);

  const metaRows: [string, string][] = [
    ['Status', experiment.status.replace(/_/g, ' ').toUpperCase()],
    ['Experiment Date', experiment.experiment_date || ''],
    ['Created', format(new Date(experiment.created_at), 'yyyy-MM-dd HH:mm')],
    ['Last Modified', format(new Date(experiment.updated_at), 'yyyy-MM-dd HH:mm')],
    ['Revision', `${experiment.current_revision}`],
  ];

  if (experiment.notebook) {
    metaRows.unshift(['Notebook', experiment.notebook.name]);
  }
  if (experiment.created_by_profile) {
    metaRows.push(['Author', experiment.created_by_profile.display_name]);
  }
  if (experiment.tags && experiment.tags.length > 0) {
    metaRows.push(['Tags', experiment.tags.map(t => t.name).join(', ')]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    body: metaRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 35, textColor: [100, 100, 100] },
      1: { textColor: [30, 30, 30] },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // Divider
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Blocks
  const sortedBlocks = [...blocks].sort((a, b) => a.order_key.localeCompare(b.order_key));

  for (const block of sortedBlocks) {
    const content = block.content || {};

    switch (block.type) {
      case 'heading': {
        checkSpace(12);
        const level = content.level || 2;
        const sizes: Record<number, number> = { 1: 16, 2: 14, 3: 12 };
        doc.setFontSize(sizes[level] || 12);
        doc.setTextColor(20);
        const text = stripHtml(content.html || '');
        if (text) {
          const lines = doc.splitTextToSize(text, contentWidth);
          doc.text(lines, margin, y);
          y += lines.length * (sizes[level] || 12) * 0.5 + 4;
        }
        break;
      }

      case 'paragraph':
      case 'result': {
        const text = stripHtml(content.html || '');
        if (!text) break;
        checkSpace(10);
        if (block.type === 'result' && content.label) {
          doc.setFontSize(11);
          doc.setTextColor(20, 120, 20);
          doc.text(content.label, margin, y);
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
        const items: string[] = content.items || [];
        const isNumbered = content.type === 'numbered';
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
        const items: Array<{ text: string; checked: boolean }> = content.items || [];
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
        const params: Array<{ name: string; value: string; unit: string; description?: string }> = content.parameters || [];
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
        y = (doc as any).lastAutoTable.finalY + 6;
        break;
      }

      case 'table': {
        const cols: Array<{ name: string }> = content.columns || [];
        const rows: string[][] = content.rows || [];
        if (cols.length === 0) break;
        checkSpace(10);

        if (content.caption) {
          doc.setFontSize(9);
          doc.setTextColor(100);
          doc.text(content.caption, margin, y);
          y += 5;
        }

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [cols.map(c => c.name)],
          body: rows,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold' },
        });
        y = (doc as any).lastAutoTable.finalY + 6;
        break;
      }

      case 'image': {
        if (!content.url) break;
        checkSpace(60);
        try {
          const imgWidth = Math.min(contentWidth, 140);
          doc.addImage(content.url, 'JPEG', margin, y, imgWidth, imgWidth * 0.6);
          y += imgWidth * 0.6 + 3;
          if (content.caption) {
            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(content.caption, margin, y);
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
        if (!content.filename) break;
        checkSpace(8);
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(`\u{1F4CE} ${content.displayName || content.filename}`, margin + 4, y);
        y += 5;
        if (content.caption) {
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(content.caption, margin + 8, y);
          y += 4;
        }
        y += 2;
        break;
      }

      case 'protocol': {
        checkSpace(15);
        doc.setFontSize(11);
        doc.setTextColor(20);
        doc.text(
          `Protocol: ${content.protocol_name || 'Protocol'} (v${content.version_number || '?'})`,
          margin, y
        );
        y += 7;

        const steps = content.steps || [];
        const deviations = content.deviations || [];
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

          const dev = deviations.find((d: any) => d.step_index === i);
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
        const text = stripHtml(content.html || '');
        if (!text) break;
        checkSpace(10);
        const typeLabels: Record<string, string> = { note: 'Note', warning: 'Warning', tip: 'Tip', danger: 'Important' };
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`[${typeLabels[content.type] || 'Note'}]`, margin, y);
        y += 5;
        doc.setFontSize(10);
        doc.setTextColor(60);
        const lines = doc.splitTextToSize(text, contentWidth - 8);
        doc.text(lines, margin + 4, y);
        y += lines.length * 5 + 4;
        break;
      }

      case 'reference': {
        checkSpace(10);
        doc.setFontSize(9);
        doc.setTextColor(60);
        let refText = '';
        if (content.citation) refText = content.citation;
        else if (content.title) refText = content.title;
        if (content.doi) refText += ` DOI: ${content.doi}`;
        if (content.url && !content.doi) refText += ` ${content.url}`;
        if (refText) {
          const lines = doc.splitTextToSize(refText, contentWidth);
          doc.text(lines, margin + 4, y);
          y += lines.length * 4 + 3;
        }
        break;
      }

      case 'related_experiment': {
        checkSpace(6);
        doc.setFontSize(9);
        doc.setTextColor(60);
        doc.text(
          `Related: ${content.experiment_display_id || ''} \u2014 ${content.title || ''}`,
          margin + 4, y
        );
        y += 6;
        break;
      }

      case 'code': {
        const code = content.code || '';
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

  // Signatures section
  if (options?.signatures && options.signatures.length > 0) {
    checkSpace(20);
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text('Electronic Signatures', margin, y);
    y += 7;

    for (const sig of options.signatures) {
      checkSpace(15);
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(`Signer: ${sig.signer?.display_name || 'Unknown'}`, margin + 4, y);
      y += 5;
      doc.text(`Revision: ${sig.revision_number}`, margin + 4, y);
      y += 5;
      doc.text(`Date: ${format(new Date(sig.signed_at), 'yyyy-MM-dd HH:mm:ss')} UTC`, margin + 4, y);
      y += 5;
      doc.text(`Declaration: ${sig.declaration}`, margin + 4, y);
      y += 7;
    }
  }

  // Reviews section
  if (options?.reviews && options.reviews.length > 0) {
    checkSpace(15);
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text('Review History', margin, y);
    y += 6;

    for (const rev of options.reviews) {
      checkSpace(10);
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(
        `${rev.reviewer?.display_name || 'Reviewer'}: ${rev.status.replace(/_/g, ' ')} (${rev.reviewed_at ? format(new Date(rev.reviewed_at), 'yyyy-MM-dd') : 'pending'})`,
        margin + 4, y
      );
      y += 5;
      if (rev.comment) {
        doc.text(`Comment: ${rev.comment}`, margin + 8, y);
        y += 5;
      }
    }
  }

  // Update page count in all footers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  doc.save(`${experiment.experiment_id}_${experiment.title.replace(/\s+/g, '_').slice(0, 40)}.pdf`);
}
