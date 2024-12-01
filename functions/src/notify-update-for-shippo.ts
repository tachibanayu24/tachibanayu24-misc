import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { IncomingWebhook, IncomingWebhookSendArguments } from "@slack/webhook";
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

function extractItems(
  html: string
): { url: string; name: string; imageUrl: string }[] {
  const root = cheerio.load(html);
  const items: { url: string; name: string; imageUrl: string }[] = [];

  const itemElements = root(".item_box");
  itemElements.each((_index, element) => {
    const item = root(element);
    const linkElement = item.find(".imb_box_150 a");
    const nameElement = item.find(".name a");
    const imgElement = linkElement.find("img");

    const relativeUrl = linkElement.attr("href");
    const name = nameElement.text().trim();
    const imageUrl = imgElement.attr("src")?.trim();

    if (relativeUrl && name) {
      const url = `https://www.rabbittail.com${relativeUrl}`;
      const fullImageUrl = imageUrl
        ? imageUrl?.startsWith("http")
          ? imageUrl
          : `https://www.rabbittail.com${imageUrl}`
        : "";
      items.push({ url, name, imageUrl: fullImageUrl });
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
        const blocks: IncomingWebhookSendArguments["blocks"] = [];

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "<!channel> 新しい子がデビューしました！",
          },
        });

        newItems.forEach((item) => {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🐰 <${item.url}|${item.name}>`,
            },
            accessory: {
              type: "image",
              image_url: item.imageUrl,
              alt_text: item.name,
            },
          });
        });

        await webhook.send({ blocks });
        logger.info("Sent message to Slack", { newItems });
      } else {
        logger.info("No new items detected");
      }

      await docRef.set({ items: currentItems });
    } catch (error) {
      logger.error("Error occurred", { error });
    }
  }
);
