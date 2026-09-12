import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { Resume } from "@/types";

// The API receives a resume data object without technical metadata fields
type ResumeInput = Omit<Resume, "id" | "created_at" | "parsed_at" | "last_updated" | "resume_link">;

// --- Color palette (matches Python script) ---
const COLORS = {
  primary: "#1976D2", // Modern blue
  secondary: "#455A64", // Dark blue-gray
  text: "#212121", // Near black
  light: "#757575", // Medium gray
  hrLine: "#2C3E50", // Section divider color
};

// --- Page constants (matches Python: letter, 0.6" margins) ---
const MARGIN = 0.6 * 72; // 0.6 inches in points
const PAGE_WIDTH = 612; // Letter width in points
const PAGE_HEIGHT = 792; // Letter height in points
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// --- Abbreviation-safe sentence splitter (matches Python) ---
const ABBREVIATIONS: Record<string, string> = {
  "e.g.": "TEMP_EG",
  "i.e.": "TEMP_IE",
  "etc.": "TEMP_ETC",
  "vs.": "TEMP_VS",
  "Mr.": "TEMP_MR",
  "Mrs.": "TEMP_MRS",
  "Ms.": "TEMP_MS",
  "Dr.": "TEMP_DR",
  "St.": "TEMP_ST",
  "Ph.D.": "TEMP_PHD",
  "U.S.": "TEMP_US",
  "U.K.": "TEMP_UK",
};

function protectAbbreviations(text: string): string {
  let result = text;
  for (const [abbr, placeholder] of Object.entries(ABBREVIATIONS)) {
    result = result.replaceAll(abbr, placeholder);
  }
  return result;
}

function restoreAbbreviations(text: string): string {
  let result = text;
  for (const [abbr, placeholder] of Object.entries(ABBREVIATIONS)) {
    result = result.replaceAll(placeholder, abbr);
  }
  return result;
}

function splitIntoSentences(text: string): string[] {
  const protectedText = protectAbbreviations(text.trim());
  const rawSentences = protectedText.split(". ");

  const sentences: string[] = [];
  for (let i = 0; i < rawSentences.length; i++) {
    let sentence = rawSentences[i];
    if (!sentence) continue;
    sentence = restoreAbbreviations(sentence);

    // Add period back if not the last sentence, or if the last sentence doesn't end with punctuation
    if (
      i < rawSentences.length - 1 ||
      ![".", "!", "?"].includes(sentence[sentence.length - 1])
    ) {
      sentence = sentence + ".";
    }

    sentences.push(sentence.trim());
  }
  return sentences;
}

function isNA(value: string | null | undefined): boolean {
  return !value || value === "NA";
}

// --- Helper: Check if we need a new page ---
function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
  }
}

// --- Section heading with horizontal rule ---
function drawSectionHeading(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 30);
  doc.moveDown(0.6);
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLORS.primary)
    .text(title, MARGIN, doc.y, { width: CONTENT_WIDTH });

  // Horizontal rule below heading (matches Python HRFlowable)
  const ruleY = doc.y + 2;
  doc
    .moveTo(MARGIN, ruleY)
    .lineTo(PAGE_WIDTH - MARGIN, ruleY)
    .strokeColor(COLORS.hrLine)
    .lineWidth(1)
    .stroke();
  doc.y = ruleY + 8;
}

// --- Bullet point text ---
function drawBullet(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 16);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.text)
    .text(`• ${text}`, MARGIN + 15, doc.y, {
      width: CONTENT_WIDTH - 15,
      lineGap: 2,
    });
  doc.y += 2; // spaceAfter matching Python's 4pt (approx)
}

// --- Description handler: bullets from newlines or sentence splitting ---
function drawDescription(doc: PDFKit.PDFDocument, description: string) {
  if (description.includes("\n")) {
    const bullets = description.split("\n");
    for (const bullet of bullets) {
      const trimmed = bullet.trim();
      if (!trimmed) continue;
      let bulletText = trimmed;
      if (bulletText.startsWith("-")) {
        bulletText = bulletText.substring(1).trim();
      } else if (bulletText.startsWith("•")) {
        bulletText = bulletText.substring(1).trim();
      }
      drawBullet(doc, bulletText);
    }
  } else {
    const sentences = splitIntoSentences(description);
    for (const sentence of sentences) {
      if (sentence) {
        drawBullet(doc, sentence);
      }
    }
  }
}

// --- Two-column row (left text + right-aligned text) ---
function drawTwoColumnRow(
  doc: PDFKit.PDFDocument,
  leftText: string,
  leftFont: string,
  leftSize: number,
  leftColor: string,
  rightText: string,
  rightFont: string,
  rightSize: number,
  rightColor: string,
  leftWidth: number,
  rightWidth: number
) {
  ensureSpace(doc, 20);
  const startY = doc.y;

  // Draw left text
  doc.font(leftFont).fontSize(leftSize).fillColor(leftColor);

  // If the leftText contains <b> tags, we need to handle rich text
  // For simplicity, just render the text (PDFKit doesn't support HTML tags)
  const cleanLeftText = leftText.replace(/<\/?b>/g, "");
  doc.text(cleanLeftText, MARGIN, startY, {
    width: leftWidth,
    continued: false,
  });

  const leftEndY = doc.y;

  // Draw right text (right-aligned)
  doc.font(rightFont).fontSize(rightSize).fillColor(rightColor);
  doc.text(rightText, MARGIN + leftWidth, startY, {
    width: rightWidth,
    align: "right",
  });

  const rightEndY = doc.y;
  doc.y = Math.max(leftEndY, rightEndY);
}

export async function POST(request: NextRequest) {
  try {
    const resumeData: ResumeInput = await request.json();

    const doc = new PDFDocument({
      size: "LETTER",
      margins: {
        top: MARGIN,
        bottom: MARGIN,
        left: MARGIN,
        right: MARGIN,
      },
      autoFirstPage: true,
      bufferPages: true,
    });

    // Collect PDF bytes into a buffer
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // ===== HEADER: Name =====
    if (resumeData.name) {
      doc
        .font("Helvetica-Bold")
        .fontSize(26)
        .fillColor(COLORS.primary)
        .text(resumeData.name.toUpperCase(), MARGIN, MARGIN, {
          width: CONTENT_WIDTH,
        });
      doc.moveDown(0.3);
    }

    // ===== CONTACT INFORMATION =====
    const contactParts: string[] = [];
    if (!isNA(resumeData.email)) contactParts.push(resumeData.email);
    if (!isNA(resumeData.phone)) contactParts.push(resumeData.phone);
    if (!isNA(resumeData.location)) contactParts.push(resumeData.location);

    if (contactParts.length > 0) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.secondary)
        .text(contactParts.join(" | "), { width: CONTENT_WIDTH });
      doc.y += 2;
    }

    // ===== LINKS =====
    if (resumeData.links) {
      const linkItems: { label: string; url: string }[] = [];

      if (!isNA(resumeData.links.linkedin)) {
        const url = resumeData.links.linkedin!.startsWith("http")
          ? resumeData.links.linkedin!
          : `https://${resumeData.links.linkedin}`;
        linkItems.push({ label: "LinkedIn", url });
      }
      if (!isNA(resumeData.links.github)) {
        const url = resumeData.links.github!.startsWith("http")
          ? resumeData.links.github!
          : `https://${resumeData.links.github}`;
        linkItems.push({ label: "GitHub", url });
      }
      if (!isNA(resumeData.links.portfolio)) {
        const url = resumeData.links.portfolio!.startsWith("http")
          ? resumeData.links.portfolio!
          : `https://${resumeData.links.portfolio}`;
        linkItems.push({ label: "Portfolio", url });
      }

      if (linkItems.length > 0) {
        doc.font("Helvetica").fontSize(9).fillColor(COLORS.primary);
        const startX = MARGIN;
        let currentX = startX;
        const lineY = doc.y;

        for (let i = 0; i < linkItems.length; i++) {
          const item = linkItems[i];
          const labelWidth = doc.widthOfString(item.label);

          doc.fillColor(COLORS.primary).text(item.label, currentX, lineY, {
            link: item.url,
            underline: true,
            continued: false,
          });

          // Reset Y back to same line for next link
          if (i < linkItems.length - 1) {
            doc.y = lineY;
            currentX += labelWidth;
            const separator = " | ";
            const sepWidth = doc.widthOfString(separator);
            doc.fillColor(COLORS.secondary).text(separator, currentX, lineY, {
              continued: false,
            });
            doc.y = lineY;
            currentX += sepWidth;
          }
        }
        doc.y += 2;
      }
    }

    // ===== PROFESSIONAL SUMMARY =====
    if (!isNA(resumeData.summary)) {
      drawSectionHeading(doc, "PROFESSIONAL SUMMARY");

      let cleanedSummary = resumeData.summary;
      if (cleanedSummary.startsWith('"') && cleanedSummary.endsWith('"')) {
        cleanedSummary = cleanedSummary.slice(1, -1);
      }

      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(cleanedSummary, MARGIN, doc.y, {
          width: CONTENT_WIDTH,
          lineGap: 2,
        });
    }

    // ===== SKILLS (3-column layout) =====
    if (resumeData.skills && resumeData.skills.length > 0) {
      const skillsList = resumeData.skills.filter((s) => s !== "NA");

      if (skillsList.length > 0) {
        drawSectionHeading(doc, "SKILLS");

        const numColumns = 3;
        const colWidth = CONTENT_WIDTH / numColumns;
        const rows = Math.ceil(skillsList.length / numColumns);

        for (let i = 0; i < rows; i++) {
          ensureSpace(doc, 16);
          const rowY = doc.y;
          let maxHeight = 0;

          for (let j = 0; j < numColumns; j++) {
            const skillIndex = i * numColumns + j;
            if (skillIndex < skillsList.length) {
              const skillText = `• ${skillsList[skillIndex]}`;
              const colX = MARGIN + j * colWidth + (j === 0 ? 10 : 0);
              const adjustedWidth = colWidth - (j === 0 ? 10 : 0) - 6;

              doc
                .font("Helvetica")
                .fontSize(10)
                .fillColor(COLORS.text)
                .text(skillText, colX, rowY, {
                  width: adjustedWidth,
                  lineGap: 2,
                });

              const cellHeight = doc.y - rowY;
              if (cellHeight > maxHeight) maxHeight = cellHeight;
            }
          }
          doc.y = rowY + maxHeight + 3; // 3pt bottom padding per row
        }

        doc.y += 0.1 * 72; // Spacer(1, 0.1*inch)
      }
    }

    // ===== PROFESSIONAL EXPERIENCE =====
    if (resumeData.experience && resumeData.experience.length > 0) {
      drawSectionHeading(doc, "PROFESSIONAL EXPERIENCE");

      for (const exp of resumeData.experience) {
        // Job title + dates row
        const jobTitle = isNA(exp.job_title) ? "" : exp.job_title;
        const companyParts: string[] = [];
        if (!isNA(exp.company)) companyParts.push(exp.company!);
        if (!isNA(exp.location)) companyParts.push(exp.location!);
        const companyLocation = companyParts.join(" | ");

        let dates = "";
        if (!isNA(exp.start_date) && !isNA(exp.end_date)) {
          dates = `${exp.start_date} - ${exp.end_date}`;
        } else if (!isNA(exp.start_date)) {
          dates = `${exp.start_date} - Present`;
        }

        // Two-column: job title (left, bold blue) | dates (right, italic gray)
        // Python: colWidths=[4.636*inch, 2.5*inch]
        const leftWidth = 4.636 * 72;
        const rightWidth = CONTENT_WIDTH - leftWidth;

        drawTwoColumnRow(
          doc,
          jobTitle,
          "Helvetica-Bold",
          12,
          COLORS.primary,
          dates,
          "Helvetica-Oblique",
          9,
          COLORS.light,
          leftWidth,
          rightWidth
        );

        // Company | Location
        if (companyLocation) {
          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor(COLORS.secondary)
            .text(companyLocation, MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.y += 0.1 * 72; // Spacer
        }

        // Description bullets
        if (!isNA(exp.description)) {
          drawDescription(doc, exp.description!);
        }

        doc.y += 0.15 * 72; // Spacer(1, 0.15*inch)
      }
    }

    // ===== EDUCATION =====
    if (resumeData.education && resumeData.education.length > 0) {
      drawSectionHeading(doc, "EDUCATION");

      for (const edu of resumeData.education) {
        // Degree info
        let degreeInfo = isNA(edu.degree) ? "" : edu.degree;
        if (!isNA(edu.field_of_study)) {
          degreeInfo += `, ${edu.field_of_study}`;
        }

        // Years
        let years = "";
        if (!isNA(edu.start_year) && !isNA(edu.end_year)) {
          years = `${edu.start_year} - ${edu.end_year}`;
        } else if (!isNA(edu.start_year)) {
          years = `Started ${edu.start_year}`;
        } else if (!isNA(edu.end_year)) {
          years = `Graduated ${edu.end_year}`;
        }

        // Python: colWidths=[5.15*inch, 2*inch]
        const leftWidth = 5.15 * 72;
        const rightWidth = CONTENT_WIDTH - leftWidth;

        // Degree is bold in Python (<b> tags), use Helvetica-Bold
        drawTwoColumnRow(
          doc,
          degreeInfo,
          "Helvetica-Bold",
          10,
          COLORS.text,
          years,
          "Helvetica-Oblique",
          9,
          COLORS.light,
          leftWidth,
          rightWidth
        );

        // Institution
        if (!isNA(edu.institution)) {
          doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor(COLORS.text)
            .text(edu.institution!, MARGIN, doc.y, { width: CONTENT_WIDTH });
        }

        doc.y += 0.15 * 72;
      }
    }

    // ===== PROJECTS =====
    if (resumeData.projects && resumeData.projects.length > 0) {
      drawSectionHeading(doc, "PROJECTS");

      for (const proj of resumeData.projects) {
        // Project name
        if (!isNA(proj.name)) {
          ensureSpace(doc, 20);
          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor(COLORS.primary)
            .text(proj.name, MARGIN, doc.y, { width: CONTENT_WIDTH });
          doc.y += 4;
        }

        // Description bullets
        if (!isNA(proj.description)) {
          drawDescription(doc, proj.description!);
        }

        // Technologies
        if (
          proj.technologies &&
          proj.technologies.length > 0 &&
          !(proj.technologies.length === 1 && proj.technologies[0] === "NA")
        ) {
          const techList = proj.technologies.filter((t) => t !== "NA");
          if (techList.length > 0) {
            ensureSpace(doc, 16);
            doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.light);
            doc.text(`Technologies: ${techList.join(", ")}`, MARGIN, doc.y, {
              width: CONTENT_WIDTH,
            });
            doc.y += 4;
          }
        }

        doc.y += 0.15 * 72;
      }
    }

    // ===== CERTIFICATIONS =====
    if (resumeData.certifications && resumeData.certifications.length > 0) {
      drawSectionHeading(doc, "CERTIFICATIONS");

      for (const cert of resumeData.certifications) {
        if (isNA(cert.name) && isNA(cert.issuer)) continue;

        const certName = isNA(cert.name) ? "" : cert.name;
        const yearText = isNA(cert.year) ? "" : cert.year!;

        // Python: colWidths=[5.3*inch, 2*inch]
        const leftWidth = 5.3 * 72;
        const rightWidth = CONTENT_WIDTH - leftWidth;

        drawTwoColumnRow(
          doc,
          certName,
          "Helvetica-Bold",
          10,
          COLORS.text,
          yearText,
          "Helvetica-Oblique",
          9,
          COLORS.light,
          leftWidth,
          rightWidth
        );

        // Issuer
        if (!isNA(cert.issuer)) {
          doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor(COLORS.text)
            .text(cert.issuer!, MARGIN, doc.y, { width: CONTENT_WIDTH });
        }

        doc.y += 0.1 * 72;
      }
    }

    // ===== LANGUAGES =====
    if (resumeData.languages && resumeData.languages.length > 0) {
      const langList = resumeData.languages.filter((l) => l !== "NA");
      if (langList.length > 0) {
        drawSectionHeading(doc, "LANGUAGES");
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(COLORS.text)
          .text(langList.join(", "), MARGIN, doc.y, { width: CONTENT_WIDTH });
      }
    }

    // Finalize the PDF
    doc.end();
    const pdfBuffer = await pdfPromise;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=resume.pdf",
      },
    });
  } catch (error) {
    console.error("Error generating resume PDF:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
