/* この宿の設定 */
window.APP_CONFIG = {
  hotelName: 'ICHZA KYOTO',
  hotelAddress: '京都市下京区木屋町通七条下る若宮町472-2',

  // パスポートの原本画像（撮影した画像そのもの）を保管するか。
  //   false: 保管しない（端末内で読み取って破棄し、顔写真の切り抜きだけを保存）
  //   true : 圧縮した原本画像も Drive に保存する（旅券の写しとして保存が必要な場合）
  // 外国人宿泊者の「旅券の写しの保存」は旅館業法施行規則に関わるため、
  // false で運用する前に、管轄の保健所に確認してください。
  keepOriginalPassportImage: false,
};
