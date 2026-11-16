import {
  StrictMode,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/geist"
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from "./lib/config"

const pageStyle: CSSProperties = {
  fontFamily: '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif',
  color: "oklch(14.5% 0 0)",
  padding: 16,
  margin: 0,
  fontSize: 14,
  lineHeight: "20px",
}

function OptionsApp() {
  const [url, setUrl] = useState("")
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    void getBaseUrl().then(setUrl)
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await setBaseUrl(url || DEFAULT_BASE_URL)
      setStatus("Saved. The extension will use this markx origin.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save.")
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} style={pageStyle}>
      <label htmlFor="base-url" style={{ fontWeight: 500 }}>
        markx base URL
      </label>
      <p style={{ color: "oklch(47.8% 0 0)", margin: "4px 0 8px" }}>
        Production is {DEFAULT_BASE_URL}. Use http://localhost:3000 when
        developing locally.
      </p>
      <input
        id="base-url"
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        style={{
          width: "100%",
          height: 36,
          padding: "0 10px",
          border: "1px solid oklch(92.2% 0 0)",
          borderRadius: 8,
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        style={{
          marginTop: 12,
          height: 32,
          padding: "0 12px",
          border: 0,
          borderRadius: 10,
          background: "oklch(20.5% 0 0)",
          color: "white",
          fontWeight: 500,
        }}
      >
        Save
      </button>
      {status ? (
        <p style={{ marginTop: 8, color: "oklch(47.8% 0 0)" }}>{status}</p>
      ) : null}
    </form>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OptionsApp />
    </StrictMode>
  )
}
