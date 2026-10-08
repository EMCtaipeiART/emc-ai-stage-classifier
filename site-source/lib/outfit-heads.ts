// 把頭像套到生成的服裝上用：頭像圖集與各角度的位置，數值與 Pixel Office 遊戲（app.js 的 WARDROBE.heads、buildWardrobe）同一份。
// 圖集：public/wardrobe-heads.webp（來源 EMC-ART-Pixel-Office/dist/assets/wardrobe-heads.webp，v3）。
export type HeadRect = { x: number; y: number; w: number; h: number; s?: [number, number, number, number] };
export const HEAD_NAMES = ["Leona", "Amber", "Noise", "Anna", "Machi"] as const;
export const HEAD_FEMALE = [true, true, false, true, false];      // 女生正面與側面的頭髮在衣服後面
export const HEADS: HeadRect[][] = [[{"x":0,"y":0,"w":135,"h":130,"s":[41,106,27,84]},{"x":156,"y":0,"w":117,"h":132,"s":[47,103,30,85]},{"x":312,"y":0,"w":133,"h":124}],[{"x":0,"y":156,"w":138,"h":133,"s":[38,100,25,87]},{"x":156,"y":156,"w":117,"h":132,"s":[47,104,27,85]},{"x":312,"y":156,"w":135,"h":133}],[{"x":0,"y":312,"w":108,"h":82,"s":[5,102,27,78]},{"x":156,"y":312,"w":105,"h":85,"s":[33,93,33,83]},{"x":312,"y":312,"w":110,"h":83}],[{"x":0,"y":468,"w":141,"h":131,"s":[39,108,28,86]},{"x":156,"y":468,"w":122,"h":135,"s":[53,109,29,83]},{"x":312,"y":468,"w":136,"h":127}],[{"x":0,"y":624,"w":106,"h":80,"s":[7,100,12,76]},{"x":156,"y":624,"w":105,"h":80,"s":[24,91,21,78]},{"x":312,"y":624,"w":114,"h":80}]];
export const HEAD_K = 1.7;            // 頭相對身體的放大倍率（遊戲裡的 WD_K）
export const HEAD_OVERLAP = 8;        // 下巴往身體裡蓋進去多少（遊戲裡的 WD_OV，身體圖集像素）
export const BODY_REF_HEIGHT = 168;   // 遊戲服裝圖集的身體高度（頸頂到鞋底）；生成的圖依這個換算頭的大小

export type HeadFit = { headIndex: number; scale: number; dx: [number, number, number]; dy: [number, number, number] };
export const defaultHeadFit = (headIndex = 0): HeadFit => ({ headIndex, scale: 1, dx: [0, 0, 0], dy: [0, 0, 0] });

/** 下巴在頭像圖上的位置（正面、側面用膚色框；背面用正面的下緣、左右置中）。 */
export function chinOf(headIndex: number, view: 0 | 1 | 2) {
  const rect = HEADS[headIndex][view], front = HEADS[headIndex][0];
  if (view === 2) return { x: rect.w / 2, y: front.s ? front.s[3] : rect.h * 0.62 };
  const sk = rect.s || front.s || [0, rect.w, 0, rect.h * 0.62];
  return { x: (sk[0] + sk[1]) / 2, y: sk[3] };
}

/** 各人眼睛的高度（頭像格子內的像素；[正面, 側面]）：眼鏡預設對位用，數值是遊戲裡眼鏡對位量的。 */
export const HEAD_EYE_Y: Array<[number, number]> = [[54.6, 53.7], [56.4, 53.0], [50.7, 58.4], [59.3, 53.3], [45.5, 48.4]];
