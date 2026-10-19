/**
 * GOOGLE TAG MANAGER on tailzu.space: the marketing team's container, as
 * Google hands it over. The first part goes as high in the <head> as it can,
 * the second straight after <body>. tailzu.space's home page
 * (TAILZU-WEB/index.html) carries the same two, with its Content-Security-
 * Policy (vercel.json) naming Google's hosts; the pages served from here
 * (privacy, terms, pricing, FAQ, languages, the landing pages) get them from
 * siteShell, on every page that also loads Meta's pixel, so never the pay
 * page: no third party's script runs beside a checkout.
 *
 * The container id is not a secret: it is in every page's source.
 */
export const GTM_ID = "GTM-KH975V6M";

/** The loader, for the top of <head>. */
export const gtmHead = (id: string = GTM_ID): string => `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');</script>
<!-- End Google Tag Manager -->
`;

/** The frame for browsers without JavaScript, straight after <body>. */
export const gtmBody = (id: string = GTM_ID): string => `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
`;
