import { totalOf } from './giving.ts'

export let mountGiving = (form: HTMLFormElement) => {
  let rates = JSON.parse(form.dataset.giving!)
  let amount = form.querySelector<HTMLInputElement>('[name=amount]')!
  let cover = form.querySelector<HTMLInputElement>('[name=cover]')!
  let monthly = form.querySelector<HTMLInputElement>('[value=month]')!
  let total = form.querySelector<HTMLOutputElement>('[data-gift-total]')!
  let amounts = form.querySelector<HTMLElement>('[data-amounts]')!
  let price = () => {
    total.value = totalOf({
      amount: amount.value,
      monthly: monthly.checked,
      cover: cover.checked,
    }, rates)
  }
  for (let button of amounts.querySelectorAll<HTMLButtonElement>('button')) {
    button.addEventListener('click', () => {
      amount.value = button.dataset.amount!
      price()
    })
  }
  amounts.hidden = false
  form.addEventListener('input', price)
  price()
}

if (typeof document != 'undefined') {
  let form = document.querySelector<HTMLFormElement>('form[data-giving]')
  if (form) mountGiving(form)
}
