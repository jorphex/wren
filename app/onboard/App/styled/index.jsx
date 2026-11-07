import styled from 'styled-components'

export const ONBOARDING_SCENE_SCRIM =
  'linear-gradient(90deg, rgba(7, 11, 10, 0.88) 0%, rgba(7, 11, 10, 0.66) 40%, rgba(7, 11, 10, 0.18) 68%, rgba(7, 11, 10, 0.08) 100%)'

export const Onboard = styled.div`
  position: absolute;
  top: 0px;
  right: 0;
  bottom: 0;
  left: 0;
  color: var(--outerspace);
  background: var(--wren-bg-canvas);
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
  min-height: 0;
  overflow: hidden;
  background: var(--wren-bg-canvas);
`

export const Slide = styled.div`
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 700;
  box-sizing: border-box;
  overflow: hidden;
  background: ${({ $background }) =>
    $background ? `${ONBOARDING_SCENE_SCRIM}, url(${$background}) center / cover no-repeat` : 'transparent'};
`
