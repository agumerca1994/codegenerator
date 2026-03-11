import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ningún archivo PDF." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Archivo inválido. Solo se aceptan PDFs." }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "El PDF supera el máximo de 10MB." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = await pdfParse(buffer);

    return NextResponse.json({
      fileName: file.name,
      pages: parsed.numpages,
      text: parsed.text?.trim() ?? ""
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo extraer texto del PDF. Verifica que no esté protegido o dañado." },
      { status: 500 }
    );
  }
}
