// 3D 辦公室的座位（只列辦公桌的位子；會議室、茶水間、長桌、廁所不算）。座標是椅子的版面 px（四樓含 3600 的 x 偏移），
// 直接量自 pixel-plaza/index.html 執行時的 chairSeats。改了辦公室家具要重新量、兩邊一起改。
// 座位編號 "S:x:z:t|b"（t＝坐桌後面向鏡頭、b＝坐桌前背對鏡頭）。
export type SeatPos = { key: string; floor: 4 | 5; x: number; z: number; back: boolean };

const raw5 = "463,317t 463,471b 568,317t 568,471b 673,317t 673,471b 463,554t 463,708b 568,554t 568,708b 673,554t 673,708b 463,790t 463,944b 568,790t 568,944b 673,790t 673,944b 938,317t 938,471b 1043,317t 1043,471b 804,554t 804,708b 935,554t 935,708b 1040,554t 1040,708b 833,790t 833,944b 938,790t 938,944b 1043,790t 1043,944b 138,317t 138,471b 243,317t 243,471b 138,554t 138,708b 243,554t 243,708b 222,955b";
const raw4 = "3692,385t 3692,539b 3797,385t 3797,539b 3902,385t 3902,539b 4007,385t 4007,539b 3692,617t 3692,771b 3797,617t 3797,771b 3902,617t 3902,771b 4007,617t 4007,771b 3692,850t 3692,1004b 3797,850t 3797,1004b 3902,850t 3902,1004b 4007,850t 4007,1004b 3692,1082t 3692,1236b 3797,1082t 3797,1236b 3902,1082t 3902,1236b 4007,1082t 4007,1236b 3692,1315t 3692,1469b 3797,1315t 3797,1469b 3902,1315t 3902,1469b 4007,1315t 4007,1469b 4315,825t 4315,979b 4420,825t 4420,979b 4315,1058t 4315,1212b 4420,1058t 4420,1212b 4666,825t 4666,979b 4771,825t 4771,979b 4666,1058t 4666,1212b 4771,1058t 4771,1212b";
const parse = (text: string, floor: 4 | 5): SeatPos[] => text.split(" ").map((item) => { const [x, rest] = item.split(","); const z = parseInt(rest, 10); return { key: `S:${x}:${z}:${rest.slice(-1)}`, floor, x: Number(x), z, back: rest.endsWith("b") }; });

export const SEATS_5F = parse(raw5, 5);
export const SEATS_4F = parse(raw4, 4);
export const ALL_SEATS: SeatPos[] = [...SEATS_5F, ...SEATS_4F];
export const SEAT_KEYS = new Set(ALL_SEATS.map((s) => s.key));
export const seatKey = (x: number, z: number, back: boolean) => `S:${x}:${z}:${back ? "b" : "t"}`;

/** 3D 辦公室寫死的 12 位設計部人物的固定座位（要和 pixel-plaza/index.html 的 SEATS／SEATS4 一致）。 */
export const FIXED_SEATS: Record<string, string> = {
  Leona: seatKey(463, 790, false), Amber: seatKey(568, 790, false), Noise: seatKey(673, 790, false), Anna: seatKey(568, 944, true), Machi: seatKey(673, 944, true),
  吳冠賢: seatKey(833, 944, true), 廖秦葦: seatKey(833, 790, false), 李明庭: seatKey(938, 790, false),
  黎子瑄: seatKey(4007, 1236, true), 余采馨: seatKey(3797, 1236, true), 鄭筱舢: seatKey(3902, 1236, true), 王藍庭: seatKey(3692, 1469, true),
};

/** 畫座位圖用：同一欄上下成對的座位 → 一張桌子。 */
export function desksOf(seats: SeatPos[]) {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const top of seats.filter((s) => !s.back)) {
    const bottom = seats.find((s) => s.back && s.x === top.x && s.z > top.z && s.z - top.z < 260);
    if (bottom) out.push({ x: top.x - 50, y: top.z + 36, w: 100, h: bottom.z - top.z - 72 });
  }
  return out;
}
