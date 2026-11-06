/**
 * Phone numbers and texts: a person's number as `phone{number}`, the consent they gave
 * to be texted as `sms_consent{person, consent, at}`, and `mobile` to put a
 * typed number in the form both are kept in.
 */

export { phoneDoc } from './vocab.ts'

/**
 * A US mobile number in E.164 form, or null when `typed` is not one.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { mobile } from '@yaks/phone'
 * equal(mobile('(269) 555-0142'), '+12695550142')
 * equal(mobile('+1 269 555 0142'), '+12695550142')
 * equal(mobile('555-0142'), null)
 * equal(mobile('(069) 555-0142'), null)
 * equal(mobile('(876) 555-0142'), null)
 * equal(mobile('(900) 555-0142'), null)
 * equal(mobile('(530) 555-0142'), '+15305550142')
 * equal(mobile('(851) 555-0142'), null)
 * equal(mobile('(299) 555-0142'), null)
 * ```
 */
export let mobile = (typed: string): string | null => {
  let digits = typed.replace(/\D/g, '')
  if (digits.length == 10) digits = '1' + digits
  return /^1\d{3}[2-9]\d{6}$/.test(digits) && US.has(digits.slice(1, 4))
    ? '+' + digits
    : null
}

// The area codes that are a place in the US, territories included: NANPA's
// area code report (https://reports.nanpa.com/public/npa_report.csv, file
// date 11/05/2026), the rows ASSIGNED Yes, USE G and COUNTRY US. Everything
// else sharing +1 is refused: Canada, the Caribbean and Atlantic countries,
// toll-free, premium-rate 900, the other non-geographic codes, N11 and codes
// not yet assigned. A text to the Caribbean or to 900 costs many times a US
// text and is what SMS pumping walks. A code NANPA assigns later is refused
// until it is added here.
let US = new Set(
  (
    '201 202 203 205 206 207 208 209 210 212 213 214 215 216 217 218 219 220 ' +
    '223 224 225 227 228 229 231 234 235 239 240 248 251 252 253 254 256 260 ' +
    '262 267 269 270 272 274 276 279 281 283 301 302 303 304 305 307 308 309 ' +
    '310 312 313 314 315 316 317 318 319 320 321 323 324 325 326 327 329 330 ' +
    '331 332 334 336 337 339 340 341 346 347 350 351 352 353 357 360 361 363 ' +
    '364 369 380 385 386 401 402 404 405 406 407 408 409 410 412 413 414 415 ' +
    '417 419 423 424 425 430 432 434 435 436 440 442 443 445 447 448 451 457 ' +
    '458 463 464 465 469 470 471 472 475 478 479 480 483 484 501 502 503 504 ' +
    '505 507 508 509 510 512 513 515 516 517 518 520 530 531 534 539 540 541 ' +
    '551 557 559 561 562 563 564 565 567 570 571 572 573 574 575 580 582 585 ' +
    '586 601 602 603 605 606 607 608 609 610 612 614 615 616 617 618 619 620 ' +
    '621 623 624 626 628 629 630 631 636 640 641 645 646 650 651 656 657 659 ' +
    '660 661 662 667 669 670 671 678 679 680 681 682 684 686 689 701 702 703 ' +
    '704 706 707 708 712 713 714 715 716 717 718 719 720 724 725 726 727 728 ' +
    '729 730 731 732 734 737 738 740 743 747 748 754 757 760 761 762 763 765 ' +
    '769 770 771 772 773 774 775 779 781 785 786 787 801 802 803 804 805 806 ' +
    '808 810 812 813 814 815 816 817 818 820 821 826 828 830 831 832 835 837 ' +
    '838 839 840 843 845 847 848 850 854 856 857 858 859 860 861 862 863 864 ' +
    '865 870 872 878 901 903 904 906 907 908 909 910 912 913 914 915 916 917 ' +
    '918 919 920 924 925 928 929 930 931 934 936 937 938 939 940 941 943 945 ' +
    '947 948 949 951 952 954 956 959 970 971 972 973 975 978 979 980 983 984 ' +
    '985 986 989'
  ).split(' '),
)

/**
 * A number in `mobile`'s form as a person in the US writes it; anything else
 * as it came.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { shown } from '@yaks/phone'
 * equal(shown('+12695550142'), '(269) 555-0142')
 * equal(shown('+447700900123'), '+447700900123')
 * ```
 */
export let shown = (number: string): string => {
  let d = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number)
  return d ? `(${d[1]}) ${d[2]}-${d[3]}` : number
}

export {
  type Arrival,
  Blocked,
  consentEid,
  Denied,
  type Keyword,
  keyword,
  type Outcome,
  type Receipt,
  type Sender,
  type Text,
} from './text.ts'
export { type Stash, stash } from './stash.ts'
export { arrivalEid, kept, settled } from './received.ts'
export { owed, sending, type Texting } from './send.ts'
export type { Options, Transport } from './options.ts'

export {
  type Account,
  type Heard,
  type Held,
  listens,
  type Own,
  type Provider,
  sender,
  verified,
} from './provider.ts'
export type { Caller, Frame, Line, Ring } from './call.ts'
export {
  type Address,
  type Bought,
  type Entity,
  type Numbers,
  type Offer,
  type Search,
  type Shelf,
  shelf,
  type TollFree,
  type Verification,
} from './numbers.ts'
