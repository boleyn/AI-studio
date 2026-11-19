export default function InteractiveHtmlPreview({name, body}:{name:string;body:string}) {
  return <iframe title={name} sandbox="allow-scripts" referrerPolicy="no-referrer"
          style={{display:"block", width:"100%", height:"100%", border:0}}
          srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">${body}`}/>;
}
