/** Public web address of the app, used for links in messages and shared links.
 *  Set VITE_APP_PUBLIC_URL at build time (e.g. https://fw.sunrisebayumas.com/); defaults to the custom domain. */
export const APP_PUBLIC_URL: string = (import.meta.env?.VITE_APP_PUBLIC_URL || 'https://fw.sunrisebayumas.com/').replace(/\/?$/, '/')
