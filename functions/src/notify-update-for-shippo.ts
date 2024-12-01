import * as functions from "firebase-functions";
import { WebClient } from "@slack/web-api";

const slackToken = functions.config().slack.token;
const channelId = functions.config().slack.channel;
const slackClient = new WebClient(slackToken);

const URL =
  "https://www.rabbittail.com/product/catalog/s/default/t/category/ca/rabbit/txt1/rabbit/v/b/cf9280/9281/cf9304/9305/n/100#search_area";

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
admin.initializeApp();
const db = admin.firestore();

async function getPageContent(): Promise<string> {
  const response = await fetch(URL);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.text();
}

export const notifyUpdateForShippo = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async (_ctx) => {
    try {
      const currentContent = await getPageContent();
      const docRef = db.collection("shippo-website-monitor").doc("content");

      const doc = await docRef.get();
      const previousContent = doc.exists ? doc.data()?.content : null;

      if (previousContent && currentContent !== previousContent) {
        const message = `ウェブサイトが更新されました: ${URL}`;
        await slackClient.chat.postMessage({
          channel: channelId,
          text: message,
        });
        logger.info("メッセージを送信しました: ", message);
      } else {
        logger.info("更新はありませんでした");
      }

      await docRef.set({ content: currentContent });
    } catch (error) {
      logger.error(`エラーが発生しました: ${error}`);
    }
  });
