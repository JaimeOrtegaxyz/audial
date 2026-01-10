import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SONGS_DIR = path.join(process.cwd(), "songs");
const SONG_EXTENSION = ".md";

type SongRecord = {
  id: string;
  filename: string;
  name: string;
  createdAt: string;
  prompt: string | null;
  code: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizePrompt(prompt?: string): string | null {
  if (!prompt) return null;
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function buildSongContent(params: {
  title: string;
  createdAt: string;
  prompt: string | null;
  code: string;
}): string {
  const lines: string[] = [`# ${params.title}`, `created: ${params.createdAt}`];
  if (params.prompt) {
    lines.push(`prompt: ${params.prompt}`);
  }
  lines.push("", "```strudel", params.code.trim(), "```", "");
  return lines.join("\n");
}

function parseSongContent(content: string): {
  name: string;
  createdAt: string;
  prompt: string | null;
  code: string;
} {
  const lines = content.split(/\r?\n/);
  let name = "";
  let createdAt = "";
  let prompt: string | null = null;

  for (const line of lines.slice(0, 8)) {
    if (!name && line.startsWith("# ")) {
      name = line.slice(2).trim();
      continue;
    }
    if (!createdAt && /^created:/i.test(line)) {
      createdAt = line.replace(/^created:\s*/i, "").trim();
      continue;
    }
    if (!prompt && /^prompt:/i.test(line)) {
      const value = line.replace(/^prompt:\s*/i, "").trim();
      prompt = value.length > 0 ? value : null;
    }
  }

  const codeMatch = content.match(/```(?:strudel)?\s*([\s\S]*?)```/i);
  const code = codeMatch ? codeMatch[1].trim() : content.trim();

  return { name, createdAt, prompt, code };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureSongsDir(): Promise<void> {
  await fs.mkdir(SONGS_DIR, { recursive: true });
}

async function getAvailableFilename(base: string): Promise<string> {
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const filename = `${base}${suffix}${SONG_EXTENSION}`;
    const exists = await fileExists(path.join(SONGS_DIR, filename));
    if (!exists) {
      return filename;
    }
    attempt += 1;
  }
}

async function readSongs(): Promise<SongRecord[]> {
  let entries: { name: string; isFile: () => boolean }[] = [];

  try {
    entries = await fs.readdir(SONGS_DIR, { withFileTypes: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SONG_EXTENSION))
    .map((entry) => entry.name);

  const songs = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(SONGS_DIR, filename);
      const [content, stats] = await Promise.all([
        fs.readFile(filePath, "utf8"),
        fs.stat(filePath),
      ]);
      const parsed = parseSongContent(content);
      const createdAt =
        parsed.createdAt && !Number.isNaN(Date.parse(parsed.createdAt))
          ? parsed.createdAt
          : stats.mtime.toISOString();
      const fallbackName = path.basename(filename, SONG_EXTENSION);

      return {
        id: filename,
        filename,
        name: parsed.name || fallbackName,
        createdAt,
        prompt: parsed.prompt || null,
        code: parsed.code || "",
      };
    })
  );

  return songs.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const songs = await readSongs();
    return NextResponse.json({ songs });
  } catch {
    return NextResponse.json(
      { error: "Failed to load saved songs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const rawName = typeof body?.name === "string" ? body.name.trim() : "";
    const rawCode = typeof body?.code === "string" ? body.code.trim() : "";
    const rawPrompt = typeof body?.prompt === "string" ? body.prompt : undefined;

    if (!rawCode) {
      return NextResponse.json(
        { error: "Missing song code." },
        { status: 400 }
      );
    }

    const createdAt = new Date().toISOString();
    const fallbackName = `song-${formatDateForFilename(new Date())}`;
    const name = rawName || fallbackName;
    const slug = slugify(name) || fallbackName;
    const prompt = normalizePrompt(rawPrompt);

    await ensureSongsDir();
    const filename = await getAvailableFilename(slug);
    const filePath = path.join(SONGS_DIR, filename);
    const content = buildSongContent({
      title: name,
      createdAt,
      prompt,
      code: rawCode,
    });

    await fs.writeFile(filePath, content, "utf8");

    const song: SongRecord = {
      id: filename,
      filename,
      name,
      createdAt,
      prompt,
      code: rawCode,
    };

    return NextResponse.json({ song });
  } catch {
    return NextResponse.json(
      { error: "Failed to save song." },
      { status: 500 }
    );
  }
}
