import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { IncomingWebhook } from "@slack/webhook";
import * as admin from "firebase-admin";

const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");

const URL =
  "https://www.rabbittail.com/product/catalog/s/default/t/category/ca/rabbit/txt1/rabbit/v/b/cf9280/9281/cf9304/9305/n/100#search_area";

admin.initializeApp();
const db = admin.firestore();

async function getPageContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error occurred. Status code
: ${response.status}`);
  }
  return await response.text();
}

export const notifyUpdateForShippo = onSchedule(
  {
    region: "asia-northeast1",
    schedule: "0,30 8-21 * * *",
    timeZone: "Asia/Tokyo",
    secrets: [SLACK_WEBHOOK_URL],
  },
  async (_event) => {
    try {
      logger.info("Start notifyUpdateForShippo");

      const slackWebhookUrl = SLACK_WEBHOOK_URL.value();
      const webhook = new IncomingWebhook(slackWebhookUrl);

      const currentContent = await getPageContent(URL);
      const docRef = db.collection("shippo-website-histories").doc("content");

      const doc = await docRef.get();
      const previousContent = doc.exists ? doc.data()?.content : null;

      if (previousContent && currentContent !== previousContent) {
        const message = `Update detected, ${URL}`;
        await webhook.send({ text: message });
        logger.info("Send message to Slack", message);
      } else {
        logger.info("No update detected");
      }

      await docRef.set({ content: currentContent });
    } catch (error) {
      logger.error("Error occurred", { error });
    }
  }
);
