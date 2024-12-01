import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { IncomingWebhook } from "@slack/webhook";
import * as admin from "firebase-admin";
import * as cheerio from "cheerio";

const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");

const TARGET_URL =
  "https://www.rabbittail.com/product/catalog/s/default/t/category/ca/rabbit/txt1/rabbit/v/b/cf9280/9281/cf9304/9305/n/100#search_area";

admin.initializeApp();
const db = admin.firestore();

async function getPageContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error occurred. Status code: ${response.status}`);
  }
  return await response.text();
}

function extractItems(html: string): { url: string; name: string }[] {
  const root = cheerio.load(html);
  const items: { url: string; name: string }[] = [];

  const itemElements = root(".item_box");
  itemElements.each((_index, element) => {
    const item = root(element);
    const linkElement = item.find(".imb_box_150 a");
    const nameElement = item.find(".name a");

    const relativeUrl = linkElement.attr("href");
    const name = nameElement.text().trim();

    if (relativeUrl && name) {
      const url = `https://www.rabbittail.com${relativeUrl}`;
      items.push({ url, name });
    }
  });

  return items;
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

      const htmlContent = await getPageContent(TARGET_URL);

      const currentItems = extractItems(htmlContent);

      const docRef = db.collection("shippo-website-histories").doc("items");

      const doc = await docRef.get();
      const previousItems: { url: string; name: string }[] = doc.exists
        ? doc.data()?.items || []
        : [];

      const previousUrls = new Set(previousItems.map((item) => item.url));
      const newItems = currentItems.filter(
        (item) => !previousUrls.has(item.url)
      );

      if (newItems.length > 0) {
        let message = "<!channel> 新しい子がデビューしました！\n";
        for (const item of newItems) {
          message += `<${item.url}|🐰 ${item.name}>\n`;
        }

        await webhook.send({ text: message });
        logger.info("Sent message to Slack", { message });
      } else {
        logger.info("No new items detected");
      }

      await docRef.set({ items: currentItems });
    } catch (error) {
      logger.error("Error occurred", { error });
    }
  }
);
