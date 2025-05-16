import type { APIRoute } from 'astro';
import { promises as fs } from 'fs';
import path from 'path';

let timings: { [label: string]: number[] } = {};

const TIMINGS_FILE = path.resolve('./timings.json');

async function saveTimingsToFile() {
  try {
    await fs.writeFile(TIMINGS_FILE, JSON.stringify(timings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write timings to file:', error);
  }
}

async function loadTimingsFromFile() {
  try {
    const data = await fs.readFile(TIMINGS_FILE, 'utf-8');
    timings = JSON.parse(data);
  } catch (error) {
    // file may not exist yet, ignore
    timings = {};
  }
}

await loadTimingsFromFile();

export const POST: APIRoute = async ({ request }) => {
  try {
    const { label, duration } = await request.json();

    if (!label || typeof duration !== 'number') {
      return new Response(JSON.stringify({ success: false, error: "Invalid data" }), { status: 400 });
    }

    if (!timings[label]) {
      timings[label] = [];
    }
    timings[label].push(duration);

    await saveTimingsToFile();

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: "Server error" }), { status: 500 });
  }
};

export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({ success: true, timings }, null, 2),
    { status: 200 }
  );
};
