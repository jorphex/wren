import styled from 'styled-components'

export const Onboard = styled.div`
  position: absolute;
  top: 0px;
  right: 0;
  bottom: 0;
  left: 0;
  color: var(--outerspace);
  background: var(--ghostZ);
  font-family: 'MainFont';
  font-size: 20px;
  overflow: hidden;
`

export const SlideContainer = styled.div`
  position: absolute;
  top: ${({ $immersive }) => ($immersive ? '0' : '32px')};
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  grid-template-rows: ${({ $immersive }) => ($immersive ? '1fr' : '20% 60% 20%')};
  border-top: ${({ $immersive }) => ($immersive ? '0' : '1px solid var(--ghostX)')};

  @media (max-height: 540px) {
    grid-template-rows: ${({ $immersive }) => ($immersive ? '1fr' : '18% 64% 18%')};
  }
`

export const SlideScroller = styled.div`
  position: relative;
  min-height: 0;
  display: flex;
  justify-content: center;
  align-items: center;
`

export const Slide = styled.div`
  position: relative;
  width: 100%;
  z-index: 700;
  max-height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
`

export const SlideBody = styled.div`
  max-width: 448px;
  animation: cardShow 400ms linear both;
  animation-delay: 200ms;
  font-weight: 300;
  font-size: 18px;
  margin: auto;
  text-align: center;
  div {
    padding-bottom: 30px;
    line-height: 30px;
  }
  div:last-child {
    padding-bottom: 0px;
  }

  @media (max-height: 540px) {
    font-size: 16px;

    div {
      padding-bottom: 18px;
      line-height: 24px;
    }
  }
`

export const SlideArtwork = styled.img`
  display: block;
  width: min(390px, calc(100vw - 48px));
  height: clamp(128px, 27vh, 220px);
  margin: 0 auto 18px;
  border-radius: var(--wren-radius-md);
  object-fit: cover;
  object-position: center;
  box-shadow: var(--wren-shadow-md);

  @media (max-height: 540px) {
    height: clamp(96px, 24vh, 116px);
    margin-bottom: 12px;
  }
`
export const SlideVideo = styled.div`
  font-size: 32px;
  font-weight: 500;
  animation: cardShow 400ms linear both;
  overflow: hidden;
  margin: 25px auto;
  border-radius: 6px;
  height: 240px;
  width: 390px;
  box-shadow:
    0px 8px 24px var(--ghostX),
    0px -4px 8px var(--ghostY);

  video {
    height: 100%;
  }
`

export const SlideTitle = styled.div`
  font-size: 32px;
  font-weight: 500;
  font-variation-settings:
    'CASL' 0.55,
    'CRSV' 0.25;
  letter-spacing: -0.01em;
  animation: cardShow 400ms linear both;
  animation-delay: 0s;
  display: flex;
  justify-content: center;
  align-items: flex-end;

  @media (max-height: 540px) {
    font-size: 28px;
  }
`

export const SlideProceed = styled.div`
  display: flex;
  justify-content: center;
`

export const Shortcut = styled.span`
  padding: 4px 19px 5px 19px;
  height: 42px;
  border-radius: 21px;
  font-weight: 400;
  font-size: 14px;
  border: 2px solid var(--moon);
  margin: 6px;
  white-space: nowrap;
`

export const Tag = styled.span`
  padding: 2px 8px;
  height: 40px;
  border-radius: 4px;
  background: var(--outerspace);
  color: var(--ghostZ);
  margin: 4px;
`

export const SlideItem = styled.div`
  display: flex;
  flex-direction: column;
  div {
    padding-bottom: 0px;
  }
`

export const BrowserChoices = styled.div`
  display: flex;
  justify-content: center;
  gap: 8px;
`

export const BrowserChoice = styled.button`
  display: flex;
  width: 68px;
  height: 68px;
  padding: 10px;
  align-items: center;
  justify-content: center;
  color: var(--outerspace);
  background: transparent;
  border: 0;
  border-radius: var(--wren-radius-md);
  cursor: pointer;

  &:hover {
    background: var(--wren-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--wren-focus);
    outline-offset: 2px;
  }
`

// const cardShow = keyframes`
//   0% { opacity: 0; }
//   15.82% {
//     opacity: 0;
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -9.026, 0, 0, 1);
//   }
//   21.02% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -19.292, 0, 0, 1);
//   }
//   35.34% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3.681, 0, 0, 1);
//   }
//   49.55% {
//     opacity: 1;
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.594, 0, 0, 1);
//   }
//   78.18% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.018, 0, 0, 1);
//   }
//   100% {
//     transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
//   }
// `
