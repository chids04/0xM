import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
    const { url, cookies } = context;
  
    // only check session cookie on the dashboard
    // will conditionally add when other transactions
    const publicRoutes = ['/dashboard'];
    if (!publicRoutes.includes(url.pathname)) {
      return next();
    }
  
    // Check authentication
    const sessionCookie = cookies.get('__session')?.value;
  
    if (!sessionCookie) {
      // Redirect to sign-in page if not authenticated
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/signin',
        },
      });
    }
  
    // If authenticated, proceed to the route
    return next();
  })