import { useEffect, useRef, useState } from "react";
import type { HomeCheck, HomeInfo } from "../domain/home.js";
import type { ApiClient } from "./api.js";
export function useHomeUpdates(
  api: Pick<ApiClient, "homeInfo" | "checkReleases">,
) {
  const [info, setInfo] = useState<HomeInfo>();
  const [result, setResult] = useState<HomeCheck>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let current = true;
    void api
      .homeInfo()
      .then((value) => {
        if (current) setInfo(value);
      })
      .catch(() => {
        if (current) setInfo(undefined);
      });
    return () => {
      current = false;
    };
  }, [api]);
  async function check() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setResult(await api.checkReleases());
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Release check failed. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { info, result, error, busy, check };
}
