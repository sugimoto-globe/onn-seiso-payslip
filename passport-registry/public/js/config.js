/* この宿の設定 */
window.APP_CONFIG = {
  hotelName: 'ICHZA KYOTO',
  hotelAddress: '京都市下京区木屋町通七条下る若宮町472-2',

  // パスポート画像（撮影した写真全体）を、旅券の写しとして Google ドライブに保存するか。
  //   true : 保存し、そのURLを名簿の「旅券画像URL」列に記録する（現在の運用）
  //   false: 保存しない（端末内で読み取って破棄し、文字情報だけを名簿に残す）。
  //          この運用にする前に、管轄の保健所に確認してください。
  // 画面の案内文は、この設定に合わせて自動で切り替わります。
  keepOriginalPassportImage: true,
};
