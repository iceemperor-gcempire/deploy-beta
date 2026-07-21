# 에셋 크레딧

## 3D

모든 3D 에셋은 CC0 (퍼블릭 도메인) 라이선스입니다. 표기 의무는 없으나 감사의 뜻으로 기록합니다.

- Universal Animation Library (Standard) — Quaternius — https://quaternius.com/packs/universalanimationlibrary.html (CC0) — 밀리터리 액션 애니메이션(권총 경계 Idle / 조깅 Run) 소스, VRoid 리그에 리타게팅
- ARDY — NVIDIA (https://research.nvidia.com/labs/sil/projects/ardy/, 모델 가중치 NVIDIA Open Model Agreement) — 텍스트→모션 생성으로 순찰 경계 걷기 클립 제작 (로컬 GPU 추론, scripts/assets/ardy_to_glb.py 로 리타게팅 소스 변환)
- 적 캐릭터 (애니메 걸 4종): VRoid Studio 공식 샘플 모델 (AvatarSample D/E/F/G) — VRoid/pixiv 이 CC0 로 공개, OpenGameArt 재배포판 — https://opengameart.org/content/vroid-studio-cc0-models (CC0) — Blender 로 데시메이션·본 rename·애니메이션 리타게팅 (scripts/assets/convert_vrm_girl.py)
- City Kit: Industrial — Kenney — https://kenney.nl/assets/city-kit-industrial (CC0)
- Survival Kit — Kenney — https://kenney.nl/assets/survival-kit (CC0)
- Nature Kit — Kenney — https://kenney.nl/assets/nature-kit (CC0)
- Blaster Kit — Kenney — https://kenney.nl/assets/blaster-kit (CC0)
- 50 Lowpoly Guns — Quaternius — https://quaternius.itch.io/50-lowpoly-guns (CC0)
- Car Kit — Kenney — https://kenney.nl/assets/car-kit (CC0)

## 텍스처

- Ground048, Gravel023 — ambientCG — https://ambientcg.com (CC0) — 지면/자갈 마당 컬러맵 (1K JPG 재압축)

FBX → GLB 변환: Blender 5.1 headless (총기, 캐릭터+애니메이션).

## 사운드

- Impact Sounds — Kenney — https://kenney.nl/assets/impact-sounds (CC0) — 발소리, 피격/착지/낙하 임팩트
- Interface Sounds — Kenney — https://kenney.nl/assets/interface-sounds (CC0) — 탈출 진행음/완료음
- RPG Audio — Kenney — https://kenney.nl/assets/rpg-audio (CC0) — 재장전, 루팅, 치료
- Sci-Fi Sounds — Kenney — https://kenney.nl/assets/sci-fi-sounds (CC0) — 사망 시 저역 붐
- Gunshot Sounds — Vincent Sevedge — https://opengameart.org/content/gunshot-sounds (CC-BY 3.0) — 소총(SKS)/권총(CZ) 총성. 단발 구간을 잘라 mono WAV 로 사용.

총성 전처리: 연속 사격 녹음에서 onset 검출로 단발 추출 후 페이드아웃/정규화 (Python).
