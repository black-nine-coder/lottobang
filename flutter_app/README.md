# Flutter Wrapper

이 디렉터리는 기존 `추첨 패턴 연구실` 데이터를 아이폰에서 오프라인으로 읽기 위한 Flutter 앱 소스입니다.

## 현재 상태

- `flutter` CLI가 이 작업 환경에 설치돼 있지 않아 프로젝트 파일은 수동으로 준비했습니다.
- Flutter 설치 후 한 번만 `flutter create . --platforms=ios` 를 실행하면 iOS 실행에 필요한 기본 Runner 파일이 생성됩니다.
- 앱은 `assets/data/manifest.json`, `assets/data/data_bundle.json` 을 기본 데이터로 사용합니다.

## 권장 실행 순서

1. 오프라인 데이터 번들 생성
   `python3 scripts/generate_mobile_data.py`
2. Flutter 설치 후 이 폴더로 이동
   `cd flutter_app`
3. 기본 iOS 프로젝트 생성
   `flutter create . --platforms=ios`
4. 패키지 설치
   `flutter pub get`
5. 오프라인 앱 실행
   `flutter run`
6. 원격 데이터 최신화까지 붙이려면 manifest 주소를 지정
   `flutter run --dart-define=LOTTOBANG_MANIFEST_URL=https://example.com/manifest.json`

## iPhone 주의사항

- 완전 오프라인 사용만 할 때는 서버가 필요 없습니다.
- 원격 최신화는 `manifest.json` 과 `data_bundle.json` 을 HTTPS로 제공하는 주소가 필요합니다.
- iOS에서 HTTP 주소로 manifest 를 받으려면 `ios/Runner/Info.plist` 에 `NSAppTransportSecurity` 예외가 필요할 수 있습니다.

추가할 값 예시:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```
