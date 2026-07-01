import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";

/**
 * Shared read-only code viewer built on CodeMirror — virtualized rendering, so
 * large files (HTML/CSS/etc.) stay smooth where react-syntax-highlighter chokes.
 * Same engine class as VS Code/Cline. Accepts either a `language` token
 * (typescript/html/...) or a file extension.
 */

// Map both detectLang tokens and raw extensions to CodeMirror language support.
function langExtension(lang: string): any {
  switch ((lang || "").toLowerCase()) {
    case "typescript": case "ts": return javascript({ typescript: true });
    case "tsx": return javascript({ jsx: true, typescript: true });
    case "javascript": case "js": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "python": case "py": return python();
    case "json": return json();
    case "markdown": case "md": case "mdx": return markdown();
    case "css": case "scss": return css();
    case "html": case "htm": return html();
    case "rust": case "rs": return rust();
    default: return [];
  }
}

export function CodeView({ value, language, editable, onChange, height }: {
  value: string;
  language: string;
  editable?: boolean;
  onChange?: (v: string) => void;
  height?: string;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[langExtension(language)]}
      theme={oneDark}
      editable={!!editable}
      readOnly={!editable}
      height={height || "100%"}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !!editable,
        autocompletion: !!editable,
        bracketMatching: true,
      }}
      style={{ height: height || "100%", fontSize: "12.5px" }}
    />
  );
}
