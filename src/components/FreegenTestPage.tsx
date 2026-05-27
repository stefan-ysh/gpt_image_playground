"use client";

import { useState, type CSSProperties } from "react";

type GenerateResponse = {
  ok: boolean;
  image_data?: string;
  job_id?: string;
  error?: string;
  logs?: unknown[];
};

export default function FreegenTestPage() {
  const [prompt, setPrompt] = useState(
    "cinematic ultra realistic glowing cyberpunk cat, volumetric lighting, masterpiece, photography"
  );
  const [ratio, setRatio] = useState("16:9");
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState("");
  const [logs, setLogs] = useState<string>("");

  async function handleGenerate() {
    setLoading(true);
    setImage("");
    setLogs("");

    try {
      const res = await fetch("/api/freegen-test/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          ratio_id: ratio,
        }),
      });

      const data: GenerateResponse = await res.json();

      setLogs(JSON.stringify(data, null, 2));

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Generate failed");
      }

      if (data.image_data) {
        setImage(data.image_data);
      }
    } catch (err) {
      setLogs((prev) => {
        const msg = err instanceof Error ? err.message : String(err);
        return prev ? `${prev}\n\nERROR: ${msg}` : `ERROR: ${msg}`;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>FreeGen 接口测试页</h1>
        <p style={styles.desc}>
          仅用于本地单次测试。请求通过本项目 API route 转发，避免浏览器 CORS。
        </p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={styles.textarea}
          placeholder="输入 prompt"
        />

        <div style={styles.row}>
          <select
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            style={styles.select}
          >
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="3:4">3:4</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>

          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{
              ...styles.button,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "生成中..." : "开始生成"}
          </button>
        </div>

        {image && (
          <div style={styles.imageWrap}>
            <img src={image} alt="generated" style={styles.image} />
          </div>
        )}

        <pre style={styles.log}>{logs || "等待请求..."}</pre>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0f1115",
    padding: 40,
    color: "#fff",
  },
  card: {
    maxWidth: 960,
    margin: "0 auto",
    background: "#171a21",
    border: "1px solid #2b2f3a",
    borderRadius: 16,
    padding: 24,
  },
  title: {
    margin: 0,
    fontSize: 28,
  },
  desc: {
    color: "#9ca3af",
    marginTop: 8,
  },
  textarea: {
    width: "100%",
    minHeight: 140,
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    border: "1px solid #343946",
    background: "#0f1115",
    color: "#fff",
    fontSize: 15,
    lineHeight: 1.6,
    outline: "none",
    resize: "vertical",
  },
  row: {
    display: "flex",
    gap: 12,
    marginTop: 16,
  },
  select: {
    height: 44,
    borderRadius: 10,
    border: "1px solid #343946",
    background: "#0f1115",
    color: "#fff",
    padding: "0 12px",
  },
  button: {
    height: 44,
    borderRadius: 10,
    border: "none",
    background: "#ff9800",
    color: "#fff",
    padding: "0 18px",
    fontWeight: 700,
  },
  imageWrap: {
    marginTop: 24,
  },
  image: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid #343946",
  },
  log: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    background: "#0b0d12",
    border: "1px solid #242936",
    color: "#cbd5e1",
    fontSize: 13,
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  },
};