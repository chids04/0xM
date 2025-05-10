export function createErrorResponse(code: string, message: string, status: number) {
    console.error(`${code}: ${message}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code, message },
      }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }