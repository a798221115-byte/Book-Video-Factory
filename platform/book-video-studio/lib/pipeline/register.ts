import { registerStep } from "./runner";
import { runExtract } from "../steps/extract";
import { runTranscribe } from "../steps/transcribe";
import { runAnalyze } from "../steps/analyze";
import { runRewrite } from "../steps/rewrite";
import { runTts } from "../steps/tts";
import { runSubtitle } from "../steps/subtitle";
import { runImages } from "../steps/images";
import { runRender } from "../steps/render";

let registered = false;
export function ensureRegistered() {
  if (registered) return;
  registerStep("extract", runExtract);
  registerStep("transcribe", runTranscribe);
  registerStep("analyze", runAnalyze);
  registerStep("rewrite", runRewrite);
  registerStep("tts", runTts);
  registerStep("subtitle", runSubtitle);
  registerStep("images", runImages);
  registerStep("render", runRender);
  registered = true;
}
