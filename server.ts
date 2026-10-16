// bb-plugin-expand-thinking — backend entry.
//
// BB requires a server entry, but all the work happens in the frontend
// content script (app.tsx). Nothing to do here beyond announcing the load.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
