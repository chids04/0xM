import { defineMiddleware } from "astro:middleware";
import { getAuth } from "firebase-admin/auth";
import { app } from "./firebase/server"

export const onRequest = defineMiddleware(async (context, next) => {
    const { url, cookies } = context;
  
    // only check session cookie on routes that need authorization
    // will conditionally add when other transactions
    try{
    const publicRoutes = ['/dashboard', '/profile', '/personal-milestones',
      '/shared-milestones', '/create-milestone', '/wallet', "/create",
      "/topup", "/my-nfts"];
    if (!publicRoutes.includes(url.pathname)) {
      return next();
    }
  
    // Check authentication
    const auth = getAuth(app);
    const sessionCookie = cookies.get('__session')?.value;
 
    if (!sessionCookie) {
      // Redirect to sign-in page if not authenticated
      return context.redirect("/signin")
    }
    const verifiedCookie = await auth.verifySessionCookie(sessionCookie);

    if(!verifiedCookie){
      return context.redirect("/signin")
    }
    
    //if here then verfied, set user prop to be passed
    context.locals.user = await auth.getUser(verifiedCookie.uid);
    } catch(error){

      return context.redirect("/signin")
    }
  
    return next();
  })