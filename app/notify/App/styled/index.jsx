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

export const Container = styled.div`
  position: absolute;
  top: 32px;
  right: 0;
  bottom: 0;
  left: 0;
  border-top: 1px solid var(--ghostX);
  overflow-y: scroll;
`

export const Item = styled.div`
  display: flex;
  flex-direction: column;
  div {
    padding-bottom: 0px;
  }
`

export const Body = styled.div`
  max-width: 500px;
  animation: cardShow 400ms linear both;
  animation-delay: 200ms;
  font-weight: 300;
  font-size: 15px;
  padding: 8px;
  margin: auto;
  text-align: center;
  ${Item} {
    padding-bottom: 20px;
    line-height: 20px;
  }
  ${Item}:last-child {
    padding-bottom: 0px;
  }
`

export const Title = styled.div`
  font-size: 24px;
  font-weight: 400;
  animation: cardShow 400ms linear both;
  animation-delay: 0s;
  height: 100px;
  display: flex;
  justify-content: center;
  align-items: center;
`
