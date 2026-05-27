"use client";

import { useRef, useState, type CSSProperties } from "react";

type Mode = "text-to-image" | "image-to-image";

type GenerateResponse = {
  ok: boolean;
  image_data?: string;
  job_id?: string;
  error?: string;
  logs?: unknown[];
  [key: string]: unknown;
};

export default function FreegenTestPage() {
  const [prompt, setPrompt] = useState(
    "cinematic ultra realistic glowing cyberpunk cat, volumetric lighting, masterpiece, photography"
  );
  const [ratio, setRatio] = useState("16:9");
  const [mode, setMode] = useState<Mode>("text-to-image");
  const [inputImage, setInputImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState("");
  const [logs, setLogs] = useState<string>("");

  const fileRef = useRef<HTMLInputElement | null>(null);

  async function fileToDataUrl(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;

      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(file?: File) {
    if (!file) return;

    const dataUrl = await fileToDataUrl(file);

    setInputImage(dataUrl);
    setMode("image-to-image");
  }

  function clearInputImage() {
    setInputImage("");

    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setImage("");
    setLogs("");

    try {
      if (mode === "image-to-image" && !inputImage) {
        throw new Error("图生图模式需要先上传参考图");
      }

      const payload = {
        mode,
        prompt,
        ratio_id: ratio,
        image: mode === "image-to-image" ? inputImage : undefined,
      };

      setLogs(`REQUEST:\n${JSON.stringify(payload, null, 2)}`);

      const res = await fetch("/api/freegen-test/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: GenerateResponse = await res.json();

      setLogs(
        `REQUEST:\n${JSON.stringify(payload, null, 2)}\n\nRESPONSE:\n${JSON.stringify(
          data,
          null,
          2
        )}`
      );

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
          支持文生图 / 图生图测试。图生图会把上传图片以 dataURL 传给
          <code style={styles.inlineCode}> /api/freegen-test/generate </code>
          的 <code style={styles.inlineCode}>image</code> 字段。
        </p>

        <div style={styles.tabs}>
          <button
            type="button"
            onClick={() => setMode("text-to-image")}
            style={{
              ...styles.tab,
              ...(mode === "text-to-image" ? styles.tabActive : {}),
            }}
          >
            文生图
          </button>

          <button
            type="button"
            onClick={() => setMode("image-to-image")}
            style={{
              ...styles.tab,
              ...(mode === "image-to-image" ? styles.tabActive : {}),
            }}
          >
            图生图
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={styles.textarea}
          placeholder="输入 prompt"
        />

        {mode === "image-to-image" && (
          <div style={styles.uploadBox}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />

            <div style={styles.row}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={styles.secondaryButton}
              >
                上传参考图
              </button>

              {inputImage && (
                <button
                  type="button"
                  onClick={clearInputImage}
                  style={styles.dangerButton}
                >
                  清除参考图
                </button>
              )}
            </div>

            {inputImage ? (
              <div style={styles.previewWrap}>
                <div style={styles.previewTitle}>参考图预览</div>
                <img src={inputImage} alt="input" style={styles.preview} />
              </div>
            ) : (
              <div style={styles.emptyHint}>尚未上传参考图</div>
            )}
          </div>
        )}

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
            <div style={styles.previewTitle}>生成结果</div>
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
    height: "100dvh",
    overflowY: "auto",
    background: "#0f1115",
    padding: 40,
    color: "#fff",
    boxSizing: "border-box",
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
    lineHeight: 1.7,
  },
  inlineCode: {
    background: "#0f1115",
    border: "1px solid #343946",
    borderRadius: 6,
    padding: "2px 6px",
    color: "#fbbf24",
  },
  tabs: {
    display: "flex",
    gap: 10,
    marginTop: 18,
  },
  tab: {
    height: 36,
    borderRadius: 999,
    border: "1px solid #343946",
    background: "#0f1115",
    color: "#9ca3af",
    padding: "0 16px",
    cursor: "pointer",
  },
  tabActive: {
    background: "#ff9800",
    borderColor: "#ff9800",
    color: "#fff",
    fontWeight: 700,
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
  uploadBox: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    border: "1px dashed #343946",
    background: "#11141b",
  },
  row: {
    display: "flex",
    gap: 12,
    marginTop: 16,
    alignItems: "center",
    flexWrap: "wrap",
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
  secondaryButton: {
    height: 40,
    borderRadius: 10,
    border: "1px solid #343946",
    background: "#20242e",
    color: "#fff",
    padding: "0 14px",
    cursor: "pointer",
  },
  dangerButton: {
    height: 40,
    borderRadius: 10,
    border: "1px solid #7f1d1d",
    background: "#2a1212",
    color: "#fecaca",
    padding: "0 14px",
    cursor: "pointer",
  },
  previewWrap: {
    marginTop: 16,
  },
  previewTitle: {
    marginBottom: 8,
    color: "#cbd5e1",
    fontSize: 14,
  },
  preview: {
    display: "block",
    maxWidth: 320,
    maxHeight: 320,
    borderRadius: 12,
    border: "1px solid #343946",
    objectFit: "contain",
  },
  emptyHint: {
    marginTop: 14,
    color: "#6b7280",
    fontSize: 14,
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